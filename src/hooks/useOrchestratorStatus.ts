import { useCallback, useEffect, useState } from "react";
import type { OrchestratorStatusData } from "@/shared/orchestrator";
import { callTool } from "../lib/api";

/**
 * Hook that provides real-time orchestrator status via SSE.
 *
 * Fetches the full status on mount, then subscribes to `/sse/activity`
 * for state-changing events (session_start, status). When an event
 * arrives, it triggers an immediate re-fetch for the complete status
 * shape — no polling interval needed.
 */
export function useOrchestratorStatus() {
  const [status, setStatus] = useState<OrchestratorStatusData["status"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await callTool<OrchestratorStatusData>(
        "orchestrator_status",
      );
      setStatus(data.status);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let disposed = false;
    const retryDelay = { current: 1000 };
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      es = new EventSource("/sse/activity");

      es.addEventListener("open", () => {
        retryDelay.current = 1000;
        // Fetch on every (re)connect — covers initial mount and reconnects
        // where state may have changed while disconnected.
        fetchStatus();
      });

      // Session started → refetch for full status (includes activeSession, phase)
      es.addEventListener("session_start", () => {
        fetchStatus();
      });

      // State change (session_end, enable, stop) → refetch for full status
      es.addEventListener("status", () => {
        fetchStatus();
      });

      es.addEventListener("error", () => {
        es?.close();
        es = null;
        if (!disposed) {
          retryTimer = setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
            connect();
          }, retryDelay.current);
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [fetchStatus]);

  return { status, error, refetch: fetchStatus };
}
