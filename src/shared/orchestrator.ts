import type { SessionPhaseValue } from "$convex/schema";

/**
 * Orchestrator states — runtime state of a ProjectRunner.
 * Shared between server (orchestrator) and client (UI components).
 *
 * IDLE: waiting for work.
 * BUSY: active session in progress.
 */
export const OrchestratorState = {
  Idle: "idle",
  Busy: "busy",
} as const;
export type OrchestratorState =
  (typeof OrchestratorState)[keyof typeof OrchestratorState];

/** Public shape of an active session exposed by orchestrator_status. */
export interface OrchestratorActiveSession {
  sessionId: string;
  issueId?: string;
  pid: number;
  phase: SessionPhaseValue;
}

/** The status payload returned by the orchestrator_status tool. */
export interface OrchestratorStatusData {
  status: {
    state: OrchestratorState;
    readyCount: number;
    activeSession: OrchestratorActiveSession | null;
  };
}
