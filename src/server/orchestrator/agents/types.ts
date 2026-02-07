// ── Disposition ──────────────────────────────────────────────────────
// Single source of truth lives in convex/schema.ts — re-export here for convenience.

import { Disposition as _Disposition } from "$convex/schema";
export { _Disposition as Disposition };
export type Disposition = (typeof _Disposition)[keyof typeof _Disposition];

export type DispositionResult =
  | { success: true; disposition: Disposition; note: string }
  | { success: false; error: string };

// ── Prompt context types ─────────────────────────────────────────────

export interface WorkPromptContext {
  shortId: string;
  title: string;
  description?: string;
  comments?: Array<{ author: string; content: string }>;
}

export interface RetroPromptContext {
  shortId: string;
  title: string;
  /** Summary from the work session's disposition note */
  workNote?: string;
}

export interface ReviewPromptContext {
  shortId: string;
  title: string;
  description?: string;
  /** Output of git diff startHead..HEAD */
  diff: string;
  /** Output of git log startHead..HEAD --oneline */
  commitLog: string;
  /** Follow-up issues already created (from retro/previous reviews) */
  relatedIssues: Array<{ shortId: string; title: string; status: string }>;
  /** 1-indexed review iteration */
  reviewIteration: number;
  maxReviewIterations: number;
}

// ── Agent process types ──────────────────────────────────────────────

export interface SpawnOptions {
  cwd: string;
  prompt: string;
}

export interface ResumeOptions {
  cwd: string;
  prompt: string;
  /** Provider-specific session ID (e.g., Claude CLI session UUID) */
  sessionId: string;
}

export interface AgentProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
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
}
