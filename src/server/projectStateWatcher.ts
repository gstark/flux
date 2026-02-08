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
 * Per-project transition lock. Transitions are async (enable, stop, kill all
 * involve network calls), but Convex's onUpdate callback is synchronous and
 * fire-and-forget. Without serialization, rapid state changes (e.g. running →
 * stopped) can race: handleRunning's enable() hasn't finished when handleStopped
 * checks for an existing orchestrator, finds none, and returns — leaving the
 * orchestrator enabled with no one to stop it.
 *
 * Each project chains its transitions: a new transition awaits the previous
 * one before executing. Errors are caught per-transition so a failure doesn't
 * block future transitions.
 */
const transitionLocks = new Map<Id<"projects">, Promise<void>>();

function enqueueTransition(
  projectId: Id<"projects">,
  fn: () => Promise<void>,
): void {
  const prev = transitionLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // Run fn regardless of previous outcome
  transitionLocks.set(projectId, next);
}

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

      // Enqueue transition: serialized per project to prevent races between
      // rapid state changes (e.g. running → stopped before enable() completes).
      if (next !== undefined) {
        enqueueTransition(project._id, () => handleTransition(project, next));
      }
    }

    // Clean up tracked state for removed projects
    const currentIds = new Set(snapshots.map((p) => p._id));
    for (const id of previousStates.keys()) {
      if (!currentIds.has(id)) {
        previousStates.delete(id);
        transitionLocks.delete(id);
      }
    }
  });

  return unsubscribe;
}

async function handleTransition(
  project: ProjectSnapshot,
  targetState: ProjectStateValue,
): Promise<void> {
  switch (targetState) {
    case ProjectState.Running:
      await handleRunning(project);
      break;
    case ProjectState.Paused:
      await handlePaused(project);
      break;
    case ProjectState.Stopped:
      await handleStopped(project);
      break;
  }
}

/**
 * Reset project state in Convex after a failed transition.
 * This ensures the UI reflects reality: if enable() failed, the project
 * isn't actually running.
 */
async function resetProjectState(
  projectId: Id<"projects">,
  rollbackState: ProjectStateValue,
  originalError: unknown,
): Promise<void> {
  console.error(
    `[ProjectStateWatcher] Resetting project ${projectId} to "${rollbackState}" after failed transition`,
  );
  try {
    const convex = getConvexClient();
    await convex.mutation(api.projects.update, {
      projectId,
      state: rollbackState,
    });
  } catch (resetErr) {
    // If even the rollback fails, we're in a bad spot — log both errors
    // so the operator can investigate. The project state in Convex is now
    // desynchronized from the orchestrator.
    console.error(
      `[ProjectStateWatcher] CRITICAL: Failed to reset project ${projectId} to "${rollbackState}". ` +
        `Project state is desynchronized.`,
      { originalError, resetErr },
    );
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
    // Orchestrator never started — reset to stopped so UI reflects reality
    await resetProjectState(project._id, ProjectState.Stopped, err);
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
    // stop() failed — orchestrator is still running, reset to running
    await resetProjectState(project._id, ProjectState.Running, err);
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
    // Kill/cleanup failed — orchestrator is still alive, reset to paused
    // (it may be partially stopped but not fully cleaned up)
    await resetProjectState(project._id, ProjectState.Paused, err);
  }
}

/**
 * Get an existing orchestrator without creating one.
 * Returns null if no instance exists for the project.
 */
function getExistingOrchestrator(projectId: Id<"projects">) {
  return getAllOrchestrators().get(projectId) ?? null;
}
