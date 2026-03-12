import type {
  ProjectRunner,
  ProjectRunnerLifecycleEvent,
} from "./orchestrator";
import type { SessionMonitor } from "./orchestrator/monitor";

/** How often to send a keepalive comment to prevent proxy timeouts. */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** How often to check whether the project's runner was replaced or appeared/disappeared. */
const RUNNER_SYNC_INTERVAL_MS = 1_000;

/**
 * Create an SSE handler for a project-scoped SSE activity endpoint.
 * Keeps connections open persistently — pushes session start/end events
 * and live agent output without requiring client reconnection.
 */
export function createSSEHandler(getRunner: () => ProjectRunner | undefined) {
  return (req: Request): Response => {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
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
        let currentRunner: ProjectRunner | undefined;
        let unsubLifecycle: (() => void) | null = null;
        let lastStatusKey: string | null = null;
        let lastSessionKey: string | null = null;

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

        function sendStatusOnce(state: string, message: string): void {
          const key = `${state}:${message}`;
          if (lastStatusKey === key) return;
          lastStatusKey = key;
          send(
            formatSSE("status", {
              state,
              message,
            }),
          );
        }

        function sendSessionStartOnce(runner: ProjectRunner): void {
          const status = runner.getStatus();
          const activeSession = status.activeSession;
          if (!activeSession) return;
          const key = `${activeSession.sessionId}:${activeSession.pid}:${runner.getProviderName()}`;
          if (lastSessionKey === key) return;
          lastSessionKey = key;
          lastStatusKey = null;
          send(
            formatSSE("session_start", {
              sessionId: activeSession.sessionId,
              issueId: activeSession.issueId,
              pid: activeSession.pid,
              agent: runner.getProviderName(),
            }),
          );
        }

        function detachRunner(): void {
          currentUnsub?.();
          currentUnsub = null;
          unsubLifecycle?.();
          unsubLifecycle = null;
          currentRunner = undefined;
          lastSessionKey = null;
        }

        function attachRunner(runner: ProjectRunner): void {
          currentRunner = runner;
          const status = runner.getStatus();
          if (status.activeSession) {
            sendSessionStartOnce(runner);
            const monitor = runner.getActiveMonitor();
            if (monitor) subscribeToMonitor(monitor);
          } else {
            sendStatusOnce(status.state, "No active session");
          }

          unsubLifecycle = runner.onLifecycle(
            (event: ProjectRunnerLifecycleEvent) => {
              if (event.type === "session_start") {
                lastSessionKey = null;
                sendSessionStartOnce(runner);
                subscribeToMonitor(event.monitor);
              } else if (event.type === "session_end") {
                currentUnsub?.();
                currentUnsub = null;
                lastSessionKey = null;
                sendStatusOnce(event.state, "Session ended");
              } else if (event.type === "monitor_changed") {
                subscribeToMonitor(event.monitor);
              } else if (event.type === "state_change") {
                sendStatusOnce(event.state, "State changed");
              }
            },
          );
        }

        function syncRunnerBinding(): void {
          const nextRunner = getRunner();
          if (nextRunner === currentRunner) return;

          detachRunner();

          if (!nextRunner) {
            sendStatusOnce("disabled", "Project is not enabled or has no runner.");
            return;
          }

          attachRunner(nextRunner);
        }

        // ── Send initial state and follow runner replacement ──
        syncRunnerBinding();

        // ── Heartbeat keepalive to prevent proxy timeouts ──
        const heartbeat = setInterval(() => {
          // SSE comment line — ignored by EventSource but keeps the TCP connection alive
          if (!send(":\n\n")) {
            clearInterval(heartbeat);
          }
        }, HEARTBEAT_INTERVAL_MS);
        const runnerSync = setInterval(syncRunnerBinding, RUNNER_SYNC_INTERVAL_MS);

        // ── Clean up when client disconnects ──
        req.signal.addEventListener("abort", () => {
          detachRunner();
          clearInterval(heartbeat);
          clearInterval(runnerSync);
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
