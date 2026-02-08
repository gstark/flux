import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { SessionPhaseValue } from "$convex/schema";
import { SessionPhase } from "$convex/schema";
import { callTool } from "../lib/api";
import { FontAwesomeIcon, faPlay, faSkull, faStop } from "./Icon";

// ── Types ────────────────────────────────────────────────────────────

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

/** A pending transition: action was accepted, waiting for state to settle. */
type Transition = {
  action: "stop" | "kill" | "enable";
  /** The state we expect to leave (used to detect when transition completes). */
  fromState: "stopped" | "idle" | "busy";
};

// ── Helpers ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SessionPhaseValue, string> = {
  [SessionPhase.Work]: "Working",
  [SessionPhase.Retro]: "Retro",
  [SessionPhase.Review]: "Review",
};

const PHASE_ABBREV: Record<SessionPhaseValue, string> = {
  [SessionPhase.Work]: "W",
  [SessionPhase.Retro]: "R",
  [SessionPhase.Review]: "Rev",
};

const TRANSITION_LABELS: Record<Transition["action"], string> = {
  stop: "Stopping…",
  kill: "Killing…",
  enable: "Starting…",
};

const TRANSITION_SHORT_LABELS: Record<Transition["action"], string> = {
  stop: "Stop…",
  kill: "Kill…",
  enable: "Start…",
};

/** Max time (ms) to show a transition before giving up and clearing it. */
const TRANSITION_TIMEOUT_MS = 15_000;

/** Poll interval during a transition (ms). */
const FAST_POLL_MS = 500;

/** Normal poll interval (ms). */
const NORMAL_POLL_MS = 3_000;

/**
 * Returns true when the polled state indicates the transition is complete.
 * - stop/kill: complete when state is no longer the fromState (busy → idle/stopped)
 * - enable: complete when state is no longer "stopped"
 */
function isTransitionComplete(
  transition: Transition,
  currentState: "stopped" | "idle" | "busy",
): boolean {
  return currentState !== transition.fromState;
}

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
  const [transition, setTransition] = useState<Transition | null>(null);

  // Subscribe to orchestratorConfig for the `enabled` flag (real-time via Convex)
  const config = useQuery(api.orchestratorConfig.get, { projectId });

  // Poll orchestrator_status — faster during transitions
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transitionRef = useRef<Transition | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync so fetchStatus closure always sees current transition
  transitionRef.current = transition;

  const fetchStatus = useCallback(async () => {
    try {
      const data = await callTool<OrchestratorStatusData>(
        "orchestrator_status",
      );
      setStatus(data.status);
      setError(null);

      // Check if an active transition has completed
      const currentTransition = transitionRef.current;
      if (
        currentTransition &&
        isTransitionComplete(currentTransition, data.status.state)
      ) {
        setTransition(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Manage poll interval — restart interval when transition state changes
  useEffect(() => {
    fetchStatus();
    const interval = transition ? FAST_POLL_MS : NORMAL_POLL_MS;
    pollRef.current = setInterval(fetchStatus, interval);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, transition]);

  // Safety timeout: clear transition if it lingers too long
  useEffect(() => {
    if (transition) {
      transitionTimerRef.current = setTimeout(() => {
        setTransition(null);
      }, TRANSITION_TIMEOUT_MS);
      return () => {
        if (transitionTimerRef.current)
          clearTimeout(transitionTimerRef.current);
      };
    }
  }, [transition]);

  // Resolve issue shortId when busy
  const activeIssueId = status?.activeSession?.issueId ?? null;
  const issue = useQuery(
    api.issues.get,
    activeIssueId ? { issueId: activeIssueId as Id<"issues"> } : "skip",
  );

  // ── Actions ──────────────────────────────────────────────────────

  const handleAction = useCallback(
    async (tool: string, action: Transition["action"]) => {
      const currentState = status?.state ?? "stopped";
      setInflightAction(action);
      try {
        await callTool(tool);
        // Enter transition state — persist until poll confirms new state
        setTransition({ action, fromState: currentState });
        // Kick off an immediate poll
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setInflightAction(null);
      }
    },
    [fetchStatus, status?.state],
  );

  const handleEnable = () => handleAction("orchestrator_enable", "enable");
  const handleStop = () => handleAction("orchestrator_stop", "stop");
  const handleKill = () => handleAction("orchestrator_kill", "kill");

  // ── Derived State ────────────────────────────────────────────────

  const state = status?.state ?? "stopped";
  const enabled = config?.enabled ?? false;
  const isTransitioning = transition !== null;

  // Determine dot color + animation
  const dotClass = isTransitioning
    ? "status-warning"
    : state === "busy"
      ? "status-warning"
      : state === "idle" && enabled
        ? "status-success"
        : "status-neutral";

  const showPing = state === "busy" || isTransitioning;

  // State label (full for desktop, condensed for mobile)
  const activePhase = status?.activeSession?.phase;

  let stateLabel: string;
  let shortLabel: string;
  if (isTransitioning) {
    stateLabel = TRANSITION_LABELS[transition.action];
    shortLabel = TRANSITION_SHORT_LABELS[transition.action];
  } else if (state === "busy" && activePhase) {
    stateLabel = `${PHASE_LABELS[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`;
    shortLabel = `${PHASE_ABBREV[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`;
  } else if (state === "idle") {
    stateLabel = enabled ? "Idle" : "Disabled";
    shortLabel = stateLabel;
  } else {
    stateLabel = "Stopped";
    shortLabel = stateLabel;
  }

  // Session link target
  const activeSessionId = status?.activeSession?.sessionId ?? null;

  // Button visibility — hide all during transitions
  const showEnable = !isTransitioning && state === "stopped";
  const showStop = !isTransitioning && (state === "idle" || state === "busy");
  const showKill = !isTransitioning && state === "busy";

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
      {activeSessionId && !isTransitioning ? (
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
