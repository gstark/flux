import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { getConvexClient } from "../convex";
import { type OrphanRecoveryStats, ProjectRunner } from "./index";

/**
 * Top-level Orchestrator — single instance managing all projects.
 *
 * Watches `api.projects.list` via Convex subscription, auto-creates
 * ProjectRunner instances for enabled projects with valid paths,
 * and tears them down when projects are disabled or deleted.
 *
 * Stored on `globalThis.__fluxOrchestrator` for hot-reload survival.
 */
class Orchestrator {
  private runners = new Map<Id<"projects">, ProjectRunner>();
  private unsubscribeProjects: (() => void) | null = null;

  /** Start watching projects and auto-managing runners. */
  async start(): Promise<void> {
    const convex = getConvexClient();

    // Do an initial eager sync before subscribing so that runners
    // are created immediately (subscription callback may fire with
    // the same data, which syncRunners handles idempotently).
    const projects = await convex.query(api.projects.list, {});
    await this.syncRunners(projects);

    // Subscribe for ongoing changes
    this.unsubscribeProjects = convex.onUpdate(
      api.projects.list,
      {},
      (projects) => {
        // Fire-and-forget — syncRunners is idempotent and handles its own errors.
        this.syncRunners(projects).catch((err) => {
          console.error("[Orchestrator] syncRunners failed:", err);
        });
      },
    );
  }

  /**
   * Sync ProjectRunner instances to match the current set of enabled projects.
   *
   * Creates runners for newly-enabled projects with valid paths.
   * Destroys runners for disabled, deleted, or path-less projects.
   */
  private async syncRunners(
    projects: Array<{
      _id: Id<"projects">;
      enabled?: boolean;
      path?: string;
      slug: string;
    }>,
  ): Promise<void> {
    const desiredIds = new Set<Id<"projects">>();

    for (const project of projects) {
      const shouldRun = project.enabled === true && !!project.path;
      if (shouldRun) {
        desiredIds.add(project._id);
      }

      if (shouldRun && !this.runners.has(project._id)) {
        // Create a new runner for this project
        const path = project.path;
        if (!path) continue; // TypeScript narrowing
        try {
          const runner = new ProjectRunner(project._id, path);
          this.runners.set(project._id, runner);
          const stats = await runner.subscribe();
          logRecoveryStats(project.slug, stats);
          console.log(
            `[Orchestrator] Started runner for "${project.slug}" (${project._id})`,
          );
        } catch (err) {
          console.error(
            `[Orchestrator] Failed to start runner for "${project.slug}" (${project._id}):`,
            err,
          );
          // Remove from runners map so we retry on next sync
          this.runners.delete(project._id);
        }
      }
    }

    // Destroy runners for projects no longer in the desired set
    for (const [projectId, runner] of this.runners) {
      if (!desiredIds.has(projectId)) {
        console.log(`[Orchestrator] Stopping runner for project ${projectId}`);
        try {
          await runner.destroy();
        } catch (err) {
          console.error(
            `[Orchestrator] Error destroying runner for ${projectId}:`,
            err,
          );
        }
        this.runners.delete(projectId);
      }
    }
  }

  /** Kill the active session for a specific project. */
  async kill(projectId: Id<"projects">): Promise<void> {
    const runner = this.runners.get(projectId);
    if (!runner) {
      throw new Error(`No runner for project ${projectId}`);
    }
    await runner.kill();
  }

  /** Get a runner for a specific project (for status, SSE, etc). */
  getRunner(projectId: Id<"projects">): ProjectRunner | undefined {
    return this.runners.get(projectId);
  }

  /** Get status across all runners. */
  getStatus(): Record<string, ReturnType<ProjectRunner["getStatus"]>> {
    const result: Record<string, ReturnType<ProjectRunner["getStatus"]>> = {};
    for (const [projectId, runner] of this.runners) {
      result[projectId] = runner.getStatus();
    }
    return result;
  }

  /** Shut down the orchestrator and all runners. */
  async shutdown(): Promise<void> {
    // Unsubscribe from project list
    if (this.unsubscribeProjects) {
      this.unsubscribeProjects();
      this.unsubscribeProjects = null;
    }

    // Destroy all runners in parallel
    const destroyPromises: Promise<void>[] = [];
    for (const [projectId, runner] of this.runners) {
      destroyPromises.push(
        runner.destroy().catch((err) => {
          console.error(
            `[Orchestrator] Error destroying runner for ${projectId} during shutdown:`,
            err,
          );
        }),
      );
    }
    await Promise.all(destroyPromises);
    this.runners.clear();

    console.log("[Orchestrator] Shutdown complete");
  }
}

// Survive hot reloads: globalThis persists across Bun HMR re-evaluations.
const _global = globalThis as unknown as {
  __fluxOrchestrator?: Orchestrator;
};

/** Get or create the singleton Orchestrator. */
export function getOrCreateOrchestrator(): Orchestrator {
  if (!_global.__fluxOrchestrator) {
    _global.__fluxOrchestrator = new Orchestrator();
  }
  return _global.__fluxOrchestrator;
}

function logRecoveryStats(slug: string, stats: OrphanRecoveryStats): void {
  const parts: string[] = [];
  if (stats.deadSessions > 0) {
    parts.push(`${stats.deadSessions} dead session(s) marked failed`);
  }
  if (stats.adoptedSessions > 0) {
    parts.push(`${stats.adoptedSessions} live session(s) re-adopted`);
  }
  if (stats.orphanedIssues > 0) {
    parts.push(`${stats.orphanedIssues} orphaned issue(s) reopened`);
  }

  if (parts.length === 0) {
    console.log(`[Orchestrator] ${slug}: enabled (no orphans found)`);
  } else {
    console.log(
      `[Orchestrator] ${slug}: enabled — recovered ${parts.join(", ")}`,
    );
  }
}

export { Orchestrator };
