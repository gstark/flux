// ── Disposition ──────────────────────────────────────────────────────
// Single source of truth lives in convex/schema.ts — re-export here for convenience.

import type {
  AgentKindValue,
  DispositionValue,
  SessionPhaseValue,
} from "$convex/schema";
import {
  AgentKind as _AgentKind,
  Disposition as _Disposition,
  SessionPhase as _SessionPhase,
} from "$convex/schema";
export { _AgentKind as AgentKind };
export { _Disposition as Disposition };
export { _SessionPhase as SessionPhase };
export type Disposition = DispositionValue;
export type AgentKind = AgentKindValue;
export type SessionPhase = SessionPhaseValue;

export type DispositionResult =
  | { success: true; disposition: Disposition; note: string }
  | { success: false; error: string };

export type AgentOutputEvent =
  | { type: "session_id"; sessionId: string }
  | { type: "result"; structuredOutput?: DispositionResult };

// ── Prompt context types ─────────────────────────────────────────────

export interface WorkPromptContext {
  shortId: string;
  title: string;
  description?: string;
  comments?: Array<{ author: string; content: string }>;
  /** Previous work sessions for this issue (failed/completed attempts) */
  previousSessions?: Array<{
    sessionId: string;
    phase: string;
    disposition: string;
    note: string;
    commitLog?: string;
    commitLogError?: string;
  }>;
  /** Optional custom prompt override from project config */
  customPrompt?: string;
}

export interface RetroPromptContext {
  shortId: string;
  title: string;
  /** Summary from the work session's disposition note */
  workNote?: string;
  /** Optional custom prompt override from project config */
  customPrompt?: string;
}

export interface ReviewPromptContext {
  shortId: string;
  title: string;
  description?: string;
  comments?: Array<{ author: string; content: string }>;
  /** Output of git diff startHead..HEAD */
  diff: string;
  /** Output of git log startHead..HEAD --oneline */
  commitLog: string;
  /** Follow-up issues already created (from retro/previous reviews) */
  relatedIssues: Array<{ shortId: string; title: string; status: string }>;
  /** 1-indexed review iteration */
  reviewIteration: number;
  maxReviewIterations: number;
  /** Previous review session outcomes (only for iteration > 1) */
  previousReviews?: Array<{
    iteration: number;
    disposition: string;
    note: string;
    createdIssues?: Array<{ shortId: string; title: string }>;
    commitLog?: string;
    commitLogError?: string;
  }>;
  /** Optional custom prompt override from project config */
  customPrompt?: string;
}

// ── Agent process types ──────────────────────────────────────────────

export interface SpawnOptions {
  cwd: string;
  prompt: string;
  /** Session phase — drives phase-specific structured output schemas. */
  phase: SessionPhase;
  /** Flux session ID for tracking issue creation */
  fluxSessionId?: string;
  /** Flux issue ID — propagated to MCP so created issues get sourceIssueId */
  fluxIssueId?: string;
  /** Agent name (e.g., "claude-work", "claude-review") */
  agentName?: string;
}

export interface ResumeOptions {
  cwd: string;
  prompt: string;
  /** Provider-specific session ID (e.g., Claude CLI session UUID) */
  sessionId: string;
  /** Session phase — drives phase-specific structured output schemas. */
  phase: SessionPhase;
  /** Flux session ID for tracking issue creation */
  fluxSessionId?: string;
  /** Flux issue ID — propagated to MCP so created issues get sourceIssueId */
  fluxIssueId?: string;
  /** Agent name (e.g., "claude-work", "claude-review") */
  agentName?: string;
}

/** Minimal writable interface for agent stdin (Bun's FileSink subset). */
export interface AgentStdin {
  write(
    chunk: string | ArrayBufferView | ArrayBuffer,
  ): number | Promise<number>;
  flush(): number | Promise<number>;
  end(): void;
}

export interface AgentProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  /** Writable stdin pipe for sending messages to the agent (e.g. nudges). */
  stdin: AgentStdin | null;
  kill(): void;
  wait(): Promise<{ exitCode: number }>;
}

// ── Agent provider interface ─────────────────────────────────────────

export interface AgentProvider {
  /** Provider identifier (e.g., "claude") */
  name: string;
  /** Spawn a new agent process with the given prompt */
  spawn(opts: SpawnOptions): AgentProcess;
  /** Resume an existing session with a new prompt (e.g., retro after work) */
  resume(opts: ResumeOptions): AgentProcess;
  /** Build the prompt for a work session */
  buildWorkPrompt(ctx: WorkPromptContext): string;
  /** Build the prompt for a retro session (resumes same session) */
  buildRetroPrompt(ctx: RetroPromptContext): string;
  /** Build the prompt for a review session (stateless, new session) */
  buildReviewPrompt(ctx: ReviewPromptContext): string;
  /** Parse a raw stdout line into provider-normalized events. */
  parseOutputLine(line: string): AgentOutputEvent[];
}
