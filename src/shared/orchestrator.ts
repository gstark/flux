import type { SessionPhaseValue } from "$convex/schema";

/**
 * Orchestrator states — runtime state of the Flux daemon.
 * Shared between server (orchestrator) and client (UI components).
 *
 * STOPPED: scheduler disabled, no auto-scheduling.
 * IDLE: scheduler enabled, waiting for work.
 * BUSY: active session in progress.
 */
export const OrchestratorState = {
  Stopped: "stopped",
  Idle: "idle",
  Busy: "busy",
} as const;
export type OrchestratorState =
  (typeof OrchestratorState)[keyof typeof OrchestratorState];

/** Public shape of an active session exposed by orchestrator_status. */
export interface OrchestratorActiveSession {
  sessionId: string;
  issueId: string;
  pid: number;
  phase: SessionPhaseValue;
}

/** The status payload returned by the orchestrator_status tool. */
export interface OrchestratorStatusData {
  status: {
    state: OrchestratorState;
    schedulerEnabled: boolean;
    readyCount: number;
    activeSession: OrchestratorActiveSession | null;
  };
}
