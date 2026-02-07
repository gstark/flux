import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { callTool } from "../lib/api";

// ── Types ────────────────────────────────────────────────────────────

type SessionPhase = "work" | "retro" | "review";

type OrchestratorStatusData = {
  status: {
    state: "stopped" | "idle" | "busy";
    schedulerEnabled: boolean;
    readyCount: number;
    activeSession: {
      sessionId: string;
      issueId: string;
      pid: number;
      phase: SessionPhase;
    } | null;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SessionPhase, string> = {
  work: "Working",
  retro: "Retro",
  review: "Review",
};

// ── Component ────────────────────────────────────────────────────────

export function OrchestratorStatus({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const [status, setStatus] = useState<OrchestratorStatusData["status"] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [inflightAction, setInflightAction] = useState<string | null>(null);

  // Subscribe to orchestratorConfig for the `enabled` flag (real-time via Convex)
  const config = useQuery(api.orchestratorConfig.get, { projectId });

  // Poll orchestrator_status every 3s
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // Resolve issue shortId when busy
  const activeIssueId = status?.activeSession?.issueId ?? null;
  const issue = useQuery(
    api.issues.get,
    activeIssueId ? { issueId: activeIssueId as Id<"issues"> } : "skip",
  );

  // ── Actions ──────────────────────────────────────────────────────

  const handleAction = useCallback(
    async (tool: string, label: string) => {
      setInflightAction(label);
      try {
        await callTool(tool);
        // Immediately refresh status after action
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setInflightAction(null);
      }
    },
    [fetchStatus],
  );

  const handleEnable = () => handleAction("orchestrator_enable", "enable");
  const handleStop = () => handleAction("orchestrator_stop", "stop");
  const handleKill = () => handleAction("orchestrator_kill", "kill");

  // ── Derived State ────────────────────────────────────────────────

  const state = status?.state ?? "stopped";
  const enabled = config?.enabled ?? false;

  // Determine dot color + animation
  const dotClass =
    state === "busy"
      ? "status-warning"
      : state === "idle" && enabled
        ? "status-success"
        : "status-neutral";

  const showPing = state === "busy";

  // State label
  const stateLabel =
    state === "busy"
      ? `${PHASE_LABELS[status!.activeSession!.phase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`
      : state === "idle"
        ? enabled
          ? "Idle"
          : "Disabled"
        : "Stopped";

  // Button visibility
  const showEnable = state !== "busy" && !enabled;
  const showStop = enabled && state !== "busy";
  const showKill = state === "busy";

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2">
      {/* Status dot */}
      <div className="inline-grid *:[grid-area:1/1]">
        {showPing && (
          <div
            className={`status status-lg ${dotClass} animate-ping`}
            aria-hidden
          />
        )}
        <div
          className={`status status-lg ${dotClass}`}
          aria-label={`Orchestrator ${state}`}
        />
      </div>

      {/* State label */}
      <span className="hidden font-medium text-sm sm:inline">{stateLabel}</span>

      {/* Error tooltip */}
      {error && (
        <div className="tooltip tooltip-bottom tooltip-error" data-tip={error}>
          <span className="text-error text-xs">!</span>
        </div>
      )}

      {/* Controls */}
      {showEnable && (
        <button
          type="button"
          className="btn btn-xs btn-success btn-outline"
          disabled={inflightAction !== null}
          onClick={handleEnable}
        >
          {inflightAction === "enable" ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Enable"
          )}
        </button>
      )}

      {showStop && (
        <button
          type="button"
          className="btn btn-xs btn-warning btn-outline"
          disabled={inflightAction !== null}
          onClick={handleStop}
        >
          {inflightAction === "stop" ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Stop"
          )}
        </button>
      )}

      {showKill && (
        <button
          type="button"
          className="btn btn-xs btn-error btn-outline"
          disabled={inflightAction !== null}
          onClick={handleKill}
        >
          {inflightAction === "kill" ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Kill"
          )}
        </button>
      )}
    </div>
  );
}
