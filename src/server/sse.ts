import type { Orchestrator, OrchestratorLifecycleEvent } from "./orchestrator";
import type { SessionMonitor } from "./orchestrator/monitor";

/** How often to send a keepalive comment to prevent proxy timeouts. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Create an SSE handler for the /sse/activity endpoint.
 * Keeps connections open persistently — pushes session start/end events
 * and live agent output without requiring client reconnection.
 */
export function createSSEHandler(getOrchestrator: () => Orchestrator) {
  return (req: Request): Response => {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const orch = getOrchestrator();
        const status = orch.getStatus();

        // ── Helper: safely enqueue (no-op if controller is closed) ──
        function send(data: string): boolean {
          try {
            controller.enqueue(encoder.encode(data));
            return true;
          } catch {
            return false; // Controller closed — client disconnected
          }
        }

        // ── Track the current monitor subscription so we can swap it ──
        let currentUnsub: (() => void) | null = null;

        function subscribeToMonitor(monitor: SessionMonitor): void {
          // Unsubscribe from any previous monitor
          currentUnsub?.();

          // Send buffered history from the new monitor
          for (const line of monitor.buffer.getAll()) {
            if (!send(formatSSE("activity", { type: "line", content: line })))
              return;
          }

          // Stream new lines as they arrive
          currentUnsub = monitor.onLine((line) => {
            if (!send(formatSSE("activity", { type: "line", content: line }))) {
              currentUnsub?.();
              currentUnsub = null;
            }
          });
        }

        // ── Send initial state ──
        if (status.activeSession) {
          send(
            formatSSE("session_start", {
              sessionId: status.activeSession.sessionId,
              issueId: status.activeSession.issueId,
              pid: status.activeSession.pid,
            }),
          );

          // Pipe current monitor if active
          const monitor = orch.getActiveMonitor();
          if (monitor) {
            subscribeToMonitor(monitor);
          }
        } else {
          send(
            formatSSE("status", {
              state: status.state,
              message: "No active session",
            }),
          );
        }

        // ── Subscribe to orchestrator lifecycle events ──
        const unsubLifecycle = orch.onLifecycle(
          (event: OrchestratorLifecycleEvent) => {
            if (event.type === "session_start") {
              send(
                formatSSE("session_start", {
                  sessionId: event.sessionId,
                  issueId: event.issueId,
                  pid: event.pid,
                }),
              );
              subscribeToMonitor(event.monitor);
            } else if (event.type === "session_end") {
              // Detach from the old monitor
              currentUnsub?.();
              currentUnsub = null;
              send(
                formatSSE("status", {
                  state: event.state,
                  message: "Session ended",
                }),
              );
            } else if (event.type === "monitor_changed") {
              subscribeToMonitor(event.monitor);
            }
          },
        );

        // ── Heartbeat keepalive to prevent proxy timeouts ──
        const heartbeat = setInterval(() => {
          // SSE comment line — ignored by EventSource but keeps the TCP connection alive
          if (!send(":\n\n")) {
            clearInterval(heartbeat);
          }
        }, HEARTBEAT_INTERVAL_MS);

        // ── Clean up when client disconnects ──
        req.signal.addEventListener("abort", () => {
          currentUnsub?.();
          unsubLifecycle();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}

/** Format a Server-Sent Event message. */
function formatSSE(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
