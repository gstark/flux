import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrchestratorState } from "@/shared/orchestrator";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { SessionPhaseValue } from "$convex/schema";
import { ProjectState, SessionPhase } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus";
import { useProjectSlug } from "../hooks/useProjectId";
import { killOrchestrator } from "../lib/orchestratorApi";
import { FontAwesomeIcon, faPlay, faSkull, faStop } from "./Icon";

// ── Types ────────────────────────────────────────────────────────────

/** A pending transition: action was accepted, waiting for state to settle. */
type Transition = {
  action: "stop" | "kill" | "enable";
  /** The state we expect to leave (used to detect when transition completes). */
  fromState: OrchestratorState;
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

/**
 * Returns true when the current state indicates the transition is complete.
 * - stop/kill: complete when state is no longer the fromState (busy → idle/stopped)
 * - enable: complete when state is no longer "stopped"
 */
function isTransitionComplete(
  transition: Transition,
  currentState: OrchestratorState,
): boolean {
  return currentState !== transition.fromState;
}

// ── Component ────────────────────────────────────────────────────────

export function OrchestratorStatus({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const projectSlug = useProjectSlug();
  const {
    status,
    error: statusError,
    refetch,
  } = useOrchestratorStatus(projectId);
  const {
    error: actionError,
    showError: showActionError,
    clearError: clearActionError,
  } = useDismissableError();
  const [inflightAction, setInflightAction] = useState<string | null>(null);
  const [transition, setTransition] = useState<Transition | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to orchestratorConfig for the `enabled` flag (real-time via Convex)
  const config = useQuery(api.orchestratorConfig.get, { projectId });

  // Convex mutation for updating project state — drives orchestrator lifecycle
  // via the project state watcher (FLUX-307).
  const updateProject = useMutation(api.projects.update);

  // Clear transition when SSE-driven status update shows new state
  useEffect(() => {
    if (!status || !transition) return;
    if (isTransitionComplete(transition, status.state)) {
      setTransition(null);
    }
  }, [status, transition]);

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
    async (action: Transition["action"], fn: () => Promise<unknown>) => {
      const currentState = status?.state ?? "stopped";
      setInflightAction(action);
      try {
        await fn();
        clearActionError();
        // Enter transition state — persists until SSE-driven refetch confirms new state
        setTransition({ action, fromState: currentState });
      } catch (err) {
        showActionError(err);
        // Refetch so we don't show stale state after a failed action
        refetch();
      } finally {
        setInflightAction(null);
      }
    },
    [refetch, status?.state, clearActionError, showActionError],
  );

  // Enable/stop route through Convex project state — the project state watcher
  // handles the orchestrator lifecycle, preventing state desync (FLUX-307).
  const handleEnable = () =>
    handleAction("enable", () =>
      updateProject({ projectId, state: ProjectState.Running }),
    );
  const handleStop = () =>
    handleAction("stop", () =>
      updateProject({ projectId, state: ProjectState.Paused }),
    );
  // Kill remains a direct HTTP call — it terminates a process, not a state transition.
  const handleKill = () =>
    handleAction("kill", () => killOrchestrator(projectId));

  // ── Derived State ────────────────────────────────────────────────

  const error = actionError ?? statusError;
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
          to="/p/$projectSlug/sessions/$sessionId"
          params={{ projectSlug, sessionId: activeSessionId }}
          className="hover:underline"
        >
          {statusLabel}
        </Link>
      ) : (
        statusLabel
      )}

      {/* Error tooltip — intentionally compact for navbar context.
          Uses useDismissableError (auto-dismiss) for action errors but renders
          as a tooltip rather than ErrorBanner, which would break navbar layout. */}
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
