import { closeConvexClient } from "./convex";
import type { Orchestrator } from "./orchestrator/orchestrator";

/**
 * Graceful shutdown coordinator.
 *
 * Sequence:
 * 1. Stop accepting new HTTP connections
 * 2. Shut down the orchestrator (unsubscribes, destroys all runners)
 * 3. Close Convex client (terminates WebSocket)
 */
export async function gracefulShutdown(opts: {
  server: { stop(closeActiveConnections?: boolean): Promise<void> };
  orchestrator: Orchestrator;
}): Promise<void> {
  const { server, orchestrator } = opts;

  console.log("[Shutdown] Graceful shutdown initiated");

  // 1. Stop accepting new connections and close active ones (e.g. SSE streams).
  // Without `true`, stop() waits for all active connections to close naturally,
  // which would stall shutdown indefinitely on long-lived SSE connections.
  await server.stop(true);
  console.log("[Shutdown] HTTP server stopped");

  // 2. Shut down the orchestrator — unsubscribes from projects, destroys all runners
  // (which unsubscribe from ready issues and kill active sessions).
  await orchestrator.shutdown();

  // 3. Close Convex client
  await closeConvexClient();
  console.log("[Shutdown] Convex client closed");

  console.log("[Shutdown] Graceful shutdown complete");
}
