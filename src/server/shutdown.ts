import type { Id } from "$convex/_generated/dataModel";
import { closeConvexClient } from "./convex";
import {
  getAllOrchestrators,
  OrchestratorState,
  removeOrchestrator,
} from "./orchestrator";

/** Default time to wait for active sessions to complete before force-killing. */
const DEFAULT_GRACEFUL_TIMEOUT_MS = 60_000;

/**
 * Graceful shutdown coordinator.
 *
 * Sequence:
 * 1. Stop accepting new HTTP connections
 * 2. Unsubscribe the project state watcher (no new orchestrator transitions)
 * 3. Stop all orchestrators (unsubscribe from ready issues, no new sessions)
 * 4. Wait for active sessions to complete (up to gracefulTimeoutMs)
 * 5. Force-kill any sessions still running after timeout
 * 6. Close Convex client (terminates WebSocket)
 * 7. Exit with code 0
 */
export async function gracefulShutdown(opts: {
  server: { stop(): Promise<void> };
  unsubscribeWatcher: () => void;
  gracefulTimeoutMs?: number;
}): Promise<void> {
  const { server, unsubscribeWatcher } = opts;
  const gracefulTimeoutMs =
    opts.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS;

  console.log("[Shutdown] Graceful shutdown initiated");

  // 1. Stop accepting new connections (close idle connections immediately)
  await server.stop();
  console.log("[Shutdown] HTTP server stopped");

  // 2. Unsubscribe project state watcher — prevents new orchestrator transitions
  unsubscribeWatcher();
  console.log("[Shutdown] Project state watcher unsubscribed");

  // 3. Stop all orchestrators (unsubscribe from ready issues)
  const orchestrators = getAllOrchestrators();
  const stopPromises: Promise<void>[] = [];
  for (const [projectId, orch] of orchestrators) {
    const { state } = orch.getStatus();
    if (state !== OrchestratorState.Stopped) {
      console.log(
        `[Shutdown] Stopping orchestrator for project ${projectId} (state: ${state})`,
      );
      stopPromises.push(
        orch.stop().catch((err) => {
          console.error(
            `[Shutdown] Failed to stop orchestrator ${projectId}:`,
            err,
          );
        }),
      );
    }
  }
  await Promise.all(stopPromises);
  console.log("[Shutdown] All orchestrators told to stop");

  // 4. Wait for busy orchestrators to finish their active sessions
  const busyOrchestrators = [...orchestrators.entries()].filter(
    ([, orch]) => orch.getStatus().state === OrchestratorState.Busy,
  );

  if (busyOrchestrators.length > 0) {
    console.log(
      `[Shutdown] Waiting up to ${gracefulTimeoutMs}ms for ${busyOrchestrators.length} active session(s) to complete`,
    );

    const waitResults = await Promise.allSettled(
      busyOrchestrators.map(([, orch]) =>
        orch.waitForStopped(gracefulTimeoutMs),
      ),
    );

    // 5. Force-kill any that didn't finish in time
    const stillBusy = busyOrchestrators.filter(
      (_, i) => waitResults[i]?.status === "rejected",
    );
    if (stillBusy.length > 0) {
      console.warn(
        `[Shutdown] ${stillBusy.length} session(s) did not finish in time — force-killing`,
      );
      const killPromises: Promise<void>[] = [];
      for (const [projectId, orch] of stillBusy) {
        const { state } = orch.getStatus();
        if (state === OrchestratorState.Busy) {
          console.log(
            `[Shutdown] Force-killing session for project ${projectId}`,
          );
          killPromises.push(
            orch
              .kill()
              .then(() => orch.waitForStopped(10_000))
              .catch((err) => {
                console.error(
                  `[Shutdown] Force-kill failed for ${projectId}:`,
                  err,
                );
              }),
          );
        }
      }
      await Promise.all(killPromises);
    }
  }

  // 6. Remove all orchestrator instances
  for (const [projectId] of orchestrators) {
    try {
      removeOrchestrator(projectId as Id<"projects">);
    } catch (err) {
      console.warn(
        `[Shutdown] Could not remove orchestrator ${projectId} (not stopped?):`,
        err,
      );
    }
  }

  // 7. Close Convex client
  await closeConvexClient();
  console.log("[Shutdown] Convex client closed");

  console.log("[Shutdown] Graceful shutdown complete");
}
