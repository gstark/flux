import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { ProjectStateValue } from "$convex/schema";
import { ProjectState } from "$convex/schema";
import { getConvexClient } from "./convex";
import {
  getAllOrchestrators,
  getOrchestrator,
  OrchestratorState,
  removeOrchestrator,
} from "./orchestrator";

/**
 * Watches project state changes via Convex subscription and drives
 * orchestrator lifecycle accordingly:
 *
 *   running → enable() (create instance if needed, subscribe to ready issues)
 *   paused  → stop()   (finish current session, then idle)
 *   stopped → kill() + removeOrchestrator() (terminate + clean up instance)
 */

type ProjectSnapshot = {
  _id: Id<"projects">;
  state: ProjectStateValue | undefined;
  path: string;
};

/**
 * Start watching all projects for state transitions.
 * Returns an unsubscribe function.
 */
export function startProjectStateWatcher(): () => void {
  const convex = getConvexClient();

  // Track previous state per project to detect transitions
  const previousStates = new Map<
    Id<"projects">,
    ProjectStateValue | undefined
  >();

  const unsubscribe = convex.onUpdate(api.projects.list, {}, (projects) => {
    const snapshots: ProjectSnapshot[] = projects.map((p) => ({
      _id: p._id,
      state: p.state,
      path: p.path ?? "",
    }));

    for (const project of snapshots) {
      const prev = previousStates.get(project._id);
      const next = project.state;

      // Always update tracked state before processing
      previousStates.set(project._id, next);

      // Skip if state hasn't changed (or first observation with no state set)
      if (prev === next) continue;

      // Apply transition: covers both first observation (server restart re-sync)
      // and normal state changes.
      if (next !== undefined) {
        handleTransition(project, next);
      }
    }

    // Clean up tracked state for removed projects
    const currentIds = new Set(snapshots.map((p) => p._id));
    for (const id of previousStates.keys()) {
      if (!currentIds.has(id)) {
        previousStates.delete(id);
      }
    }
  });

  return unsubscribe;
}

function handleTransition(
  project: ProjectSnapshot,
  targetState: ProjectStateValue,
): void {
  switch (targetState) {
    case ProjectState.Running:
      handleRunning(project);
      break;
    case ProjectState.Paused:
      handlePaused(project);
      break;
    case ProjectState.Stopped:
      handleStopped(project);
      break;
  }
}

/**
 * running → create orchestrator (if not exists) and enable().
 * Subscribes to ready issues and starts scheduling.
 */
async function handleRunning(project: ProjectSnapshot): Promise<void> {
  try {
    const orch = getOrchestrator(project._id, project.path);
    const { state } = orch.getStatus();

    // Already enabled — nothing to do
    if (state === OrchestratorState.Idle || state === OrchestratorState.Busy) {
      return;
    }

    console.log(
      `[ProjectStateWatcher] Project ${project._id} → running: enabling orchestrator`,
    );
    await orch.enable();
  } catch (err) {
    console.error(
      `[ProjectStateWatcher] Failed to enable orchestrator for project ${project._id}:`,
      err,
    );
  }
}

/**
 * paused → stop(). Finishes current session, then idles.
 * Does not pick up new issues.
 */
async function handlePaused(project: ProjectSnapshot): Promise<void> {
  try {
    // Only act if an orchestrator instance exists
    const orch = getExistingOrchestrator(project._id);
    if (!orch) return;

    const { state } = orch.getStatus();
    if (state === OrchestratorState.Stopped) return;

    console.log(
      `[ProjectStateWatcher] Project ${project._id} → paused: stopping orchestrator`,
    );
    await orch.stop();
  } catch (err) {
    console.error(
      `[ProjectStateWatcher] Failed to stop orchestrator for project ${project._id}:`,
      err,
    );
  }
}

/**
 * stopped → kill active session (if any), then remove orchestrator instance.
 * Full cleanup — instance removed from the Map.
 */
async function handleStopped(project: ProjectSnapshot): Promise<void> {
  try {
    const orch = getExistingOrchestrator(project._id);
    if (!orch) return;

    const { state } = orch.getStatus();

    if (state === OrchestratorState.Busy) {
      console.log(
        `[ProjectStateWatcher] Project ${project._id} → stopped: killing active session`,
      );
      // stop() first to unsubscribe + set pendingStop, then kill() to terminate
      await orch.stop();
      await orch.kill();
      // Wait for the exit handler → finalize() to transition to Stopped
      await orch.waitForStopped();
    } else if (state === OrchestratorState.Idle) {
      // Idle — just stop (no session to kill)
      await orch.stop();
    }
    // state is now Stopped — safe to remove

    console.log(
      `[ProjectStateWatcher] Project ${project._id} → stopped: removing orchestrator instance`,
    );
    removeOrchestrator(project._id);
  } catch (err) {
    console.error(
      `[ProjectStateWatcher] Failed to stop/remove orchestrator for project ${project._id}:`,
      err,
    );
  }
}

/**
 * Get an existing orchestrator without creating one.
 * Returns null if no instance exists for the project.
 */
function getExistingOrchestrator(projectId: Id<"projects">) {
  return getAllOrchestrators().get(projectId) ?? null;
}
