import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { SessionPhase } from "$convex/schema";
import { callTool } from "../lib/api";
import { FontAwesomeIcon, faPlay, faSkull, faStop } from "./Icon";

// ── Types ────────────────────────────────────────────────────────────

type SessionPhaseValue = (typeof SessionPhase)[keyof typeof SessionPhase];

type OrchestratorStatusData = {
  status: {
    state: "stopped" | "idle" | "busy";
    schedulerEnabled: boolean;
    readyCount: number;
    activeSession: {
      sessionId: string;
      issueId: string;
      pid: number;
      phase: SessionPhaseValue;
    } | null;
  };
};

// ── Helpers ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SessionPhaseValue, string> = {
  work: "Working",
  retro: "Retro",
  review: "Review",
};

const PHASE_ABBREV: Record<SessionPhaseValue, string> = {
  work: "W",
  retro: "R",
  review: "Rev",
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

  // State label (full for desktop, condensed for mobile)
  const activePhase = status?.activeSession?.phase;
  const stateLabel =
    state === "busy" && activePhase
      ? `${PHASE_LABELS[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`
      : state === "idle"
        ? enabled
          ? "Idle"
          : "Disabled"
        : "Stopped";

  const shortLabel =
    state === "busy" && activePhase
      ? `${PHASE_ABBREV[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`
      : stateLabel;

  // Session link target
  const activeSessionId = status?.activeSession?.sessionId ?? null;

  // Button visibility
  const showEnable = state === "stopped";
  const showStop = state === "idle" || state === "busy";
  const showKill = state === "busy";

  // ── Render ───────────────────────────────────────────────────────

  const statusLabel = (
    <>
      <span className="font-medium text-xs sm:hidden">{shortLabel}</span>
      <span className="hidden font-medium text-sm sm:inline">{stateLabel}</span>
    </>
  );

  return (
    <output
      className="flex items-center gap-2"
      aria-label={`Orchestrator: ${stateLabel}`}
    >
      {/* Status dot */}
      <div className="inline-grid *:[grid-area:1/1]">
        {showPing && (
          <div
            className={`status status-lg ${dotClass} animate-ping`}
            aria-hidden
          />
        )}
        <div className={`status status-lg ${dotClass}`} aria-hidden />
      </div>

      {/* State label: link to active session when busy, plain text otherwise */}
      {activeSessionId ? (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: activeSessionId }}
          className="hover:underline"
        >
          {statusLabel}
        </Link>
      ) : (
        statusLabel
      )}

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
            <>
              <FontAwesomeIcon icon={faPlay} aria-hidden="true" />
              Enable
            </>
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
            <>
              <FontAwesomeIcon icon={faStop} aria-hidden="true" />
              Stop
            </>
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
            <>
              <FontAwesomeIcon icon={faSkull} aria-hidden="true" />
              Kill
            </>
          )}
        </button>
      )}
    </output>
  );
}
