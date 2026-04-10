import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrchestratorState } from "@/shared/orchestrator";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { SessionPhaseValue } from "$convex/schema";
import { SessionPhase } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus";
import { useProjectSlug } from "../hooks/useProjectId";
import { killOrchestrator } from "../lib/orchestratorApi";
import { FontAwesomeIcon, faSkull } from "./Icon";

// ── Types ────────────────────────────────────────────────────────────

/** A pending transition: action was accepted, waiting for state to settle. */
type Transition = {
  action: "kill";
  /** The state we expect to leave (used to detect when transition completes). */
  fromState: OrchestratorState;
};

// ── Helpers ──────────────────────────────────────────────────────────

const PHASE_LABELS: Record<SessionPhaseValue, string> = {
  [SessionPhase.Work]: "Working",
  [SessionPhase.Retro]: "Retro",
  [SessionPhase.Review]: "Review",
  [SessionPhase.Planner]: "Planning",
};

const PHASE_ABBREV: Record<SessionPhaseValue, string> = {
  [SessionPhase.Work]: "W",
  [SessionPhase.Retro]: "R",
  [SessionPhase.Review]: "Rev",
  [SessionPhase.Planner]: "Plan",
};

/** Max time (ms) to show a transition before giving up and clearing it. */
const TRANSITION_TIMEOUT_MS = 15_000;

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

  // Reset local UI state when switching projects so stale transitions
  // from the previous project don't bleed into the new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on projectId change
  useEffect(() => {
    setInflightAction(null);
    setTransition(null);
    clearActionError();
  }, [projectId]);

  // Clear transition when SSE-driven status update shows new state
  useEffect(() => {
    if (!status || !transition) return;
    if (status.state !== transition.fromState) {
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

  const handleKill = useCallback(async () => {
    const currentState = status?.state ?? "idle";
    setInflightAction("kill");
    try {
      await killOrchestrator(projectId);
      clearActionError();
      setTransition({ action: "kill", fromState: currentState });
    } catch (err) {
      showActionError(err);
      refetch();
    } finally {
      setInflightAction(null);
    }
  }, [projectId, refetch, status?.state, clearActionError, showActionError]);

  // ── Derived State ────────────────────────────────────────────────

  const error = actionError ?? statusError;
  const state = status?.state ?? "idle";
  const isTransitioning = transition !== null;

  // Determine dot color + animation
  const dotClass = isTransitioning
    ? "status-warning"
    : state === "busy"
      ? "status-warning"
      : "status-success";

  const showPing = state === "busy" || isTransitioning;

  // State label (full for desktop, condensed for mobile)
  const activePhase = status?.activeSession?.phase;

  let stateLabel: string;
  let shortLabel: string;
  if (isTransitioning) {
    stateLabel = "Killing…";
    shortLabel = "Kill…";
  } else if (state === "busy" && activePhase) {
    stateLabel = `${PHASE_LABELS[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`;
    shortLabel = `${PHASE_ABBREV[activePhase]}${issue?.shortId ? ` ${issue.shortId}` : ""}`;
  } else {
    stateLabel = "Idle";
    shortLabel = stateLabel;
  }

  // Session link target
  const activeSessionId = status?.activeSession?.sessionId ?? null;

  // Kill button — only when busy and not already transitioning
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

      {/* Error tooltip — intentionally compact for navbar context. */}
      {error && (
        <div className="tooltip tooltip-bottom tooltip-error" data-tip={error}>
          <span className="text-error text-xs">!</span>
        </div>
      )}

      {/* Kill button */}
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
