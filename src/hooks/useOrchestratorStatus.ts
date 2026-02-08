import { useCallback, useEffect, useState } from "react";
import type { OrchestratorStatusData } from "@/shared/orchestrator";
import { callTool } from "../lib/api";
import { useSSE } from "./useSSE";

/**
 * Hook that provides real-time orchestrator status via the shared SSE connection.
 *
 * Fetches the full status on mount and on every SSE (re)connect, then
 * re-fetches whenever a state-changing event (session_start, status)
 * arrives — no polling interval needed.
 *
 * Requires an <SSEProvider> ancestor.
 */
export function useOrchestratorStatus() {
  const { subscribe } = useSSE();
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
    const unsubs: Array<() => void> = [];

    // Fetch on every (re)connect — covers initial mount and reconnects
    // where state may have changed while disconnected.
    unsubs.push(subscribe("open", () => fetchStatus()));

    // Session started → refetch for full status (includes activeSession, phase)
    unsubs.push(subscribe("session_start", () => fetchStatus()));

    // State change (session_end, enable, stop) → refetch for full status
    unsubs.push(subscribe("status", () => fetchStatus()));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [subscribe, fetchStatus]);

  return { status, error, refetch: fetchStatus };
}
