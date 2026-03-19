import {
  OrchestratorState,
  type OrchestratorStatusData,
} from "@/shared/orchestrator";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { SessionPhaseValue } from "$convex/schema";
import {
  CloseType,
  CommentAuthor,
  IssueStatus,
  SessionEventDirection,
  SessionPhase,
  SessionStatus,
  SessionType,
} from "$convex/schema";
import { getConvexClient } from "../convex";
import {
  autoCommitDirtyTree,
  getCommitLog,
  getCommitLogBetween,
  getCurrentHead,
  getDiff,
  hasNewCommits,
} from "../git";
import { isProcessAlive } from "../process";
import type {
  AgentProcess,
  AgentProvider,
  DispositionResult,
  WorkPromptContext,
} from "./agents";
import { Disposition, parseDisposition, StatusMessages } from "./agents";
import { SessionMonitor } from "./monitor";

/** Recovery stats returned by orphan recovery on startup. */
export type OrphanRecoveryStats = {
  deadSessions: number;
  adoptedSessions: number;
  orphanedIssues: number;
};

/** Runtime info about the currently active session. */
interface ActiveSession {
  sessionId: Id<"sessions">;
  issueId: Id<"issues">;
  process: AgentProcess;
  monitor: SessionMonitor;
  monitorDone: Promise<void>;
  killed: boolean;
  /** Set when the session was killed due to timeout (vs manual kill) */
  timedOut: boolean;
  /** Git HEAD when the work session started */
  startHead: string;
  /** Provider-specific session ID captured from agent output */
  agentSessionId: string | null;
  /** True if persisting agentSessionId to Convex failed. A process restart would lose it. */
  agentSessionIdPersistFailed: boolean;
  /** Issue context for prompt building */
  issue: WorkPromptContext;
  /** Current phase of the issue lifecycle */
  phase: SessionPhaseValue;
  /** Handle for the session timeout timer (cleared on normal exit) */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  /** Structured disposition from --json-schema (Claude provider only) */
  structuredOutput: DispositionResult | null;
  /** Whether commits were made during the work phase (set by handleWorkExit) */
  hasCommits: boolean | null;
  /** The work disposition — carried forward so handleRetroExit can decide review/close/finalize */
  workDisposition: Disposition | null;
}

/**
 * Lifecycle event emitted by the ProjectRunner when session state changes.
 * SSE clients subscribe to these to know when to start/stop piping monitor output.
 */
export type OrchestratorLifecycleEvent =
  | {
      type: "session_start";
      sessionId: string;
      issueId: string;
      pid: number;
      agent: string;
      monitor: SessionMonitor;
    }
  | {
      type: "session_end";
      state: OrchestratorState;
    }
  | {
      type: "monitor_changed";
      monitor: SessionMonitor;
    }
  | {
      type: "state_change";
      state: OrchestratorState;
    };

/**
 * ProjectRunner manages claiming issues, spawning agents, and session lifecycle
 * for a single project. Created/destroyed by the top-level Orchestrator.
 *
 * On construction, subscribes to ready issues and begins auto-scheduling.
 * Call destroy() to unsubscribe and clean up.
 */
class ProjectRunner {
  private state: OrchestratorState = OrchestratorState.Idle;
  private activeSession: ActiveSession | null = null;
  private provider: AgentProvider;
  private projectId: Id<"projects">;
  /** Filesystem path for the project — used as CWD when spawning agents. */
  private projectPath: string;
  private unsubscribeReady: (() => void) | null = null;
  private readyIssues: Array<{ _id: Id<"issues"> }> = [];
  private maxFailures = 3;
  private maxReviewIterations = 10;
  private sessionTimeoutMs = 30 * 60 * 1000; // 30 minutes default
  private pidWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  /** Custom prompts from project config (if any) */
  private customWorkPrompt?: string;
  private customRetroPrompt?: string;
  private customReviewPrompt?: string;
  private lifecycleListeners = new Set<
    (event: OrchestratorLifecycleEvent) => void
  >();
  private destroyed = false;
  /** Resolves when the current handleExit() call completes. Used by destroy() to await cleanup. */
  private exitHandlerDone: Promise<void> | null = null;

  constructor(
    projectId: Id<"projects">,
    projectPath: string,
    provider?: AgentProvider,
  ) {
    this.projectId = projectId;
    this.projectPath = projectPath;
    if (!provider) {
      throw new Error(
        "[ProjectRunner] provider is required. Runner construction must be explicit about agent selection.",
      );
    }
    this.provider = provider;
  }

  /** Return the current filesystem path used as CWD for spawning agents. */
  getProjectPath(): string {
    return this.projectPath;
  }

  getProjectId(): Id<"projects"> {
    return this.projectId;
  }

  getProviderName(): AgentProvider["name"] {
    return this.provider.name;
  }

  /**
   * Assert that activeSession is set, returning the narrowed type.
   * Throws immediately if null — fail fast per 'No Silent Fallbacks'.
   */
  private requireActiveSession(caller: string): ActiveSession {
    if (!this.activeSession) {
      throw new Error(
        `[ProjectRunner] ${caller}: activeSession is null — this is a bug. ` +
          "The runner should never reach this point without an active session.",
      );
    }
    return this.activeSession;
  }

  getStatus(): OrchestratorStatusData["status"] {
    return {
      state: this.state,
      readyCount: this.readyIssues.length,
      activeSession: this.activeSession
        ? {
            sessionId: this.activeSession.sessionId,
            issueId: this.activeSession.issueId,
            pid: this.activeSession.process.pid,
            phase: this.activeSession.phase,
          }
        : null,
    };
  }

  /** Get the active session's monitor (for reading live buffer). */
  getActiveMonitor(): SessionMonitor | null {
    return this.activeSession?.monitor ?? null;
  }

  /** Subscribe to lifecycle events (session start/end). Returns unsubscribe function. */
  onLifecycle(
    callback: (event: OrchestratorLifecycleEvent) => void,
  ): () => void {
    this.lifecycleListeners.add(callback);
    return () => this.lifecycleListeners.delete(callback);
  }

  /** Emit a lifecycle event to all listeners. */
  private emitLifecycle(event: OrchestratorLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(
          `[ProjectRunner] Lifecycle listener threw on ${event.type} — removing:`,
          err,
        );
        this.lifecycleListeners.delete(listener);
      }
    }
  }

  /**
   * Initialize the runner: fetch config, recover orphans, and optionally
   * subscribe to ready issues for auto-scheduling.
   *
   * @param options.autoSchedule — When true, subscribe to ready issues and
   *   auto-pick up work. When false, the runner is fully functional for
   *   manual runs, status, kill, etc. — just no auto-scheduling.
   */
  async subscribe(
    options: { autoSchedule?: boolean } = {},
  ): Promise<OrphanRecoveryStats> {
    const convex = getConvexClient();

    // Fetch project config for custom prompts
    const project = await convex.query(api.projects.getById, {
      projectId: this.projectId,
    });
    if (project) {
      this.customWorkPrompt = project.workPrompt;
      this.customRetroPrompt = project.retroPrompt;
      this.customReviewPrompt = project.reviewPrompt;
    }

    // Ensure config row exists (upsert)
    await convex.mutation(api.orchestratorConfig.ensureExists, {
      projectId: this.projectId,
    });

    // Fetch config for thresholds
    const config = await convex.query(api.orchestratorConfig.get, {
      projectId: this.projectId,
    });
    if (config) {
      this.maxFailures = config.maxFailures;
      this.maxReviewIterations = config.maxReviewIterations;
      this.sessionTimeoutMs = config.sessionTimeoutMs;
    }

    // Recover orphaned sessions before subscribing
    const stats = await this.recoverOrphanedSessions();

    if (options.autoSchedule !== false) {
      this.startAutoSchedule();
    }

    return stats;
  }

  /**
   * Enable or disable auto-scheduling of ready issues.
   * Does not affect manual runs, status, kill, etc.
   */
  setAutoSchedule(enabled: boolean): void {
    if (enabled) {
      this.startAutoSchedule();
    } else {
      this.stopAutoSchedule();
    }
  }

  private startAutoSchedule(): void {
    if (this.unsubscribeReady) return; // Already subscribed

    this.unsubscribeReady = getConvexClient().onUpdate(
      api.issues.ready,
      { projectId: this.projectId, maxFailures: this.maxFailures },
      (issues) => {
        this.readyIssues = issues;
        this.scheduleNext();
      },
    );
  }

  private stopAutoSchedule(): void {
    if (this.unsubscribeReady) {
      this.unsubscribeReady();
      this.unsubscribeReady = null;
    }
    this.readyIssues = [];
  }

  /**
   * Destroy the runner: unsubscribe from ready issues, kill active session if any.
   * After destroy(), the runner should not be used.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;

    // Unsubscribe from ready issues
    if (this.unsubscribeReady) {
      this.unsubscribeReady();
      this.unsubscribeReady = null;
    }
    this.readyIssues = [];

    // Kill active session and await the exit handler so handleExit() can
    // mark the session as Failed in Convex before the client is closed.
    if (this.state === OrchestratorState.Busy && this.activeSession) {
      this.clearSessionTimeout();
      this.clearPidWatchdog();
      this.activeSession.killed = true;
      this.activeSession.process.kill();
      if (this.exitHandlerDone) {
        await Promise.race([
          this.exitHandlerDone,
          new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
        ]);
      }
    }
  }

  /**
   * Run a single issue: claim → spawn agent → return immediately.
   * Agent exit is handled in the background via fire-and-forget.
   * Throws if runner is already busy or claim fails.
   */
  async run(
    issueId: Id<"issues">,
  ): Promise<{ sessionId: Id<"sessions">; pid: number }> {
    if (this.state === OrchestratorState.Busy) {
      throw new Error("Runner is busy. Kill the current session first.");
    }

    // Lock immediately to prevent re-entrant spawns from subscription callbacks.
    this.state = OrchestratorState.Busy;

    try {
      return await this.executeRun(issueId);
    } catch (err) {
      // Restore Idle state so the scheduler can retry with the next issue
      this.state = OrchestratorState.Idle;
      throw err;
    }
  }

  private async executeRun(
    issueId: Id<"issues">,
  ): Promise<{ sessionId: Id<"sessions">; pid: number }> {
    const convex = getConvexClient();

    // 0. Validate project path exists on disk before claiming
    if (!this.projectPath) {
      throw new Error(
        `[ProjectRunner] Cannot spawn agent: project ${this.projectId} has no path configured. ` +
          "Set a path via PATCH /api/projects/:id.",
      );
    }
    const pathExists = await Bun.file(`${this.projectPath}/.git/HEAD`).exists();
    if (!pathExists) {
      throw new Error(
        `[ProjectRunner] Cannot spawn agent: project path "${this.projectPath}" ` +
          "does not exist on disk or is not a git repository. " +
          "Was the project directory moved or deleted?",
      );
    }

    // 1. Claim the issue atomically
    const claimResult = await convex.mutation(api.issues.claim, {
      issueId,
      assignee: this.provider.name,
    });

    if (!claimResult.success) {
      throw new Error(`Failed to claim issue: ${claimResult.reason}`);
    }
    const issue = claimResult.issue;

    // 2. Use project's configured path as cwd
    const cwd = this.projectPath;

    // 3. Record startHead before spawning
    const startHead = await getCurrentHead(cwd);

    // 4. Auto-commit dirty tree before starting work.
    try {
      await autoCommitDirtyTree(cwd, issue.shortId, "pre-session");
    } catch (err) {
      console.warn(
        `[ProjectRunner] Auto-commit before session failed for ${issue.shortId} — ` +
          "proceeding with dirty tree:",
        err,
      );
    }

    // 5. Create session record first (without PID) so we have a session ID
    const session = await convex.mutation(api.sessions.create, {
      projectId: this.projectId,
      issueId,
      type: SessionType.Work,
      agent: this.provider.name,
      pid: 0, // Placeholder - will be updated after spawn
      startHead,
      phase: SessionPhase.Work,
    });
    if (!session) {
      throw new Error("Failed to create session record");
    }

    // 6. Build prompt and spawn agent with session context
    const comments = await convex.query(api.comments.list, {
      issueId,
    });
    const issueCtx: WorkPromptContext = {
      shortId: issue.shortId,
      title: issue.title,
      description: issue.description,
      comments:
        comments.length > 0
          ? comments.map((c) => ({ author: c.author, content: c.content }))
          : undefined,
      customPrompt: this.customWorkPrompt,
    };
    const prompt = this.provider.buildWorkPrompt(issueCtx);
    const agentProcess = this.provider.spawn({
      cwd,
      prompt,
      phase: SessionPhase.Work,
      fluxSessionId: session._id,
      fluxIssueId: issueId,
      agentName: `${this.provider.name}-work`,
    });

    // 7. Update session with actual PID
    await convex.mutation(api.sessions.update, {
      sessionId: session._id,
      pid: agentProcess.pid,
    });

    // 8. Start monitoring agent output
    const monitor = new SessionMonitor(session._id);
    monitor.recordInput(prompt);
    const monitorDone = monitor.consume(agentProcess.stdout);

    // 9. Track active session
    const active: ActiveSession = {
      sessionId: session._id,
      issueId,
      process: agentProcess,
      monitor,
      monitorDone,
      killed: false,
      timedOut: false,
      startHead,
      agentSessionId: null,
      agentSessionIdPersistFailed: false,
      issue: issueCtx,
      phase: SessionPhase.Work,
      timeoutTimer: null,
      structuredOutput: null,
      hasCommits: null,
      workDisposition: null,
    };
    this.activeSession = active;

    // 10. Notify SSE clients of the new session
    this.emitLifecycle({
      type: "session_start",
      sessionId: session._id,
      issueId,
      pid: agentProcess.pid,
      agent: this.provider.name,
      monitor,
    });

    // 11. Wire up provider-specific output parsing (session IDs, etc.)
    this.wireProviderOutput(active, monitor);

    // 12. Handle agent exit in background (tracked so destroy() can await it)
    this.trackProcessExit(agentProcess);

    // 12. Start session timeout enforcement
    this.startSessionTimeout();

    // 13. Start PID watchdog to detect silently-dead processes (e.g. laptop sleep)
    this.startPidWatchdog();

    return { sessionId: session._id, pid: agentProcess.pid };
  }

  // ── Session timeout enforcement ───────────────────────────────────

  private startSessionTimeout(startedAt?: number): void {
    const active = this.requireActiveSession("startSessionTimeout");
    this.clearSessionTimeout();

    let delay = this.sessionTimeoutMs;
    if (startedAt !== undefined) {
      const elapsed = Date.now() - startedAt;
      delay = Math.max(0, this.sessionTimeoutMs - elapsed);
      if (delay === 0) {
        console.warn(
          `[ProjectRunner] Re-adopted session for ${active.issue.shortId} already exceeded timeout, killing`,
        );
      }
    }

    active.timeoutTimer = setTimeout(() => {
      if (!this.activeSession || this.activeSession.killed) return;

      console.error(
        `[ProjectRunner] Session timeout (${this.sessionTimeoutMs}ms) for ${active.issue.shortId} phase=${active.phase} — sending SIGTERM`,
      );

      this.activeSession.timedOut = true;
      this.activeSession.killed = true;
      this.activeSession.process.kill();

      const pid = this.activeSession.process.pid;
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          console.error(
            `[ProjectRunner] Agent PID ${pid} still alive after 10s grace period — sending SIGKILL`,
          );
          try {
            process.kill(pid, 9);
          } catch {
            // Already dead
          }
        }
      }, 10_000);
    }, delay);
  }

  private clearSessionTimeout(): void {
    if (this.activeSession?.timeoutTimer) {
      clearTimeout(this.activeSession.timeoutTimer);
      this.activeSession.timeoutTimer = null;
    }
  }

  // ── Provider output parsing ────────────────────────────────────────

  private wireProviderOutput(
    active: ActiveSession,
    monitor: SessionMonitor,
  ): void {
    active.agentSessionId = null;
    active.agentSessionIdPersistFailed = false;
    active.structuredOutput = null;

    monitor.onLine((line) => {
      const events = this.provider.parseOutputLine(line);
      for (const event of events) {
        if (event.type === "session_id") {
          if (active.agentSessionId) return;
          active.agentSessionId = event.sessionId;
          getConvexClient()
            .mutation(api.sessions.update, {
              sessionId: active.sessionId,
              agentSessionId: event.sessionId,
            })
            .catch((err: unknown) => {
              active.agentSessionIdPersistFailed = true;
              console.error(
                "[ProjectRunner] Failed to persist agentSessionId — " +
                  "will recover in exit handler:",
                err,
              );
            });
        } else if (event.type === "result") {
          // Capture structured disposition from --json-schema if present.
          if (event.structuredOutput) {
            active.structuredOutput = event.structuredOutput;
          }
          // Close stdin so the agent sees EOF and exits.
          // With --input-format stream-json, the process stays alive
          // waiting for the next stdin message unless we signal completion.
          active.process.stdin?.end();
        }
      }
    });
  }

  // ── Disposition resolution ─────────────────────────────────────────

  /**
   * Resolve the agent's disposition, preferring structured output from
   * --json-schema over text-scanning fallback. Structured output is
   * schema-validated by Claude Code itself, so when present it's more
   * reliable than scraping the last 50 lines of stdout.
   */
  private resolveDisposition(active: ActiveSession): DispositionResult {
    if (active.structuredOutput) {
      return active.structuredOutput;
    }
    // Fallback: scan agent output lines (non-Claude providers, edge cases)
    const allLines = active.monitor.buffer.getAll();
    return parseDisposition(allLines, this.provider.name);
  }

  // ── PID watchdog ────────────────────────────────────────────────────

  private static readonly PID_WATCHDOG_INTERVAL_MS = 15_000;

  private startPidWatchdog(): void {
    this.clearPidWatchdog();
    this.pidWatchdogTimer = setInterval(() => {
      const session = this.activeSession;
      if (!session) {
        this.clearPidWatchdog();
        return;
      }
      const pid = session.process.pid;
      if (!isProcessAlive(pid)) {
        this.clearPidWatchdog();
        console.warn(
          `[ProjectRunner] PID watchdog: process ${pid} is dead, triggering handleExit(-1)`,
        );
        this.handleExit(-1);
      }
    }, ProjectRunner.PID_WATCHDOG_INTERVAL_MS);
  }

  private clearPidWatchdog(): void {
    if (this.pidWatchdogTimer) {
      clearInterval(this.pidWatchdogTimer);
      this.pidWatchdogTimer = null;
    }
  }

  /**
   * Send a nudge message to the running agent's stdin.
   *
   * The message is delivered as a stream-json user message, which the agent
   * processes between turns without interrupting its current work. This enables
   * use cases like sending hints, corrections, or `/btw` style messages.
   *
   * Throws if no active session, agent doesn't support stdin, or write fails.
   */
  async nudge(message: string): Promise<void> {
    if (this.state !== OrchestratorState.Busy || !this.activeSession) {
      throw new Error("No active session to nudge.");
    }

    const { process: agentProcess, monitor } = this.activeSession;

    if (!agentProcess.stdin) {
      throw new Error(
        `Agent "${this.provider.name}" does not support stdin nudging.`,
      );
    }

    // Format as Claude Code stream-json user message
    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: message },
    });

    await agentProcess.stdin.write(`${payload}\n`);
    await agentProcess.stdin.flush();

    // Record the nudge as an input event in the session monitor
    monitor.recordInput(payload);
  }

  /**
   * Kill the running agent immediately.
   * The exit handler will detect the `killed` flag and apply hand-off semantics.
   */
  async kill(): Promise<void> {
    if (this.state !== OrchestratorState.Busy || !this.activeSession) {
      throw new Error("No active session to kill.");
    }

    this.clearSessionTimeout();
    this.clearPidWatchdog();

    this.activeSession.killed = true;
    this.activeSession.process.kill();
  }

  // ── Exit handling ────────────────────────────────────────────────────

  /**
   * Register the exit handler for a process and track its completion.
   * Replaces direct `.wait().then()` so destroy() can await cleanup
   * before the Convex client is closed.
   */
  private trackProcessExit(agentProcess: AgentProcess): void {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.exitHandlerDone = promise;
    agentProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode).finally(resolve),
      () => this.handleExit(1).finally(resolve),
    );
  }

  private async handleExit(exitCode: number): Promise<void> {
    if (!this.activeSession) return;

    this.clearSessionTimeout();
    this.clearPidWatchdog();

    try {
      await this.activeSession.monitorDone;
    } catch (err) {
      console.error("[ProjectRunner] Monitor drain error:", err);
    }
    await this.activeSession.monitor.shutdown();

    const monitor = this.activeSession.monitor;

    if (this.activeSession.killed) {
      const convex = getConvexClient();
      const { sessionId, issueId, timedOut, issue } = this.activeSession;

      try {
        await convex.mutation(api.sessions.update, {
          sessionId,
          status: SessionStatus.Failed,
          endedAt: Date.now(),
          exitCode,
          disposition: timedOut ? Disposition.Fault : undefined,
          note: timedOut
            ? `Session timed out after ${this.sessionTimeoutMs}ms (phase: ${this.activeSession.phase})`
            : undefined,
        });

        if (timedOut) {
          console.error(
            `[ProjectRunner] Session timed out for ${issue.shortId} — incrementing failure count`,
          );
          await convex.mutation(api.issues.incrementFailure, {
            issueId,
            maxFailures: this.maxFailures,
          });
        }
      } catch (err) {
        console.error(
          `[ProjectRunner] Failed to update killed session ${sessionId}:`,
          err,
        );
      }

      this.finalize();
      return;
    }

    try {
      const { phase } = this.activeSession;
      let cleanExit = false;
      if (phase === SessionPhase.Work) {
        cleanExit = await this.handleWorkExit(exitCode);
      } else if (phase === SessionPhase.Retro) {
        cleanExit = await this.handleRetroExit();
      } else if (phase === SessionPhase.Review) {
        cleanExit = await this.handleReviewExit(exitCode);
      }
      if (cleanExit && this.activeSession === null) {
        try {
          await monitor.cleanupTmpFile();
        } catch (cleanupErr) {
          console.error(
            "[ProjectRunner] tmp file cleanup failed (non-fatal):",
            cleanupErr,
          );
        }
      }
    } catch (err) {
      console.error(
        "[ProjectRunner] Exit handler crashed — forcing finalize:",
        err,
      );
      // Best-effort: mark the current session as Failed so it doesn't stay "running" forever.
      // If this also fails (e.g. Convex still down), orphan recovery on next restart will catch it.
      const crashedSessionId = this.activeSession?.sessionId;
      if (crashedSessionId) {
        try {
          await getConvexClient().mutation(api.sessions.update, {
            sessionId: crashedSessionId,
            status: SessionStatus.Failed,
            endedAt: Date.now(),
            exitCode,
          });
        } catch (updateErr) {
          console.error(
            `[ProjectRunner] Failed to mark crashed session ${crashedSessionId} as Failed — ` +
              "will require orphan recovery on next restart:",
            updateErr,
          );
        }
      }
      this.finalize();
    }
  }

  private async handleWorkExit(exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handleWorkExit");
    const { sessionId, issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = this.projectPath;

    let endHead: string | undefined;
    try {
      endHead = await getCurrentHead(cwd);
    } catch (err) {
      console.warn(
        `[ProjectRunner] Failed to capture endHead for ${issue.shortId} — session record will omit it:`,
        err,
      );
    }

    const dispositionResult = this.resolveDisposition(active);

    if (active.agentSessionIdPersistFailed && active.agentSessionId) {
      console.warn(
        `[ProjectRunner] Early agentSessionId persist had failed for ${issue.shortId} — ` +
          "recovering via handleWorkExit session update.",
      );
    }
    await convex.mutation(api.sessions.update, {
      sessionId,
      status: SessionStatus.Completed,
      endedAt: Date.now(),
      exitCode,
      disposition: dispositionResult.success
        ? dispositionResult.disposition
        : undefined,
      note: dispositionResult.success ? dispositionResult.note : undefined,
      agentSessionId: active.agentSessionId ?? undefined,
      ...(endHead !== undefined && { endHead }),
    });

    if (!dispositionResult.success) {
      console.error(
        `[ProjectRunner] ${StatusMessages.dispositionParseFailed(issue.shortId)}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
      });
      this.finalize();
      return false;
    }

    const { disposition, note } = dispositionResult;

    if (disposition === Disposition.Fault) {
      console.error(
        `[ProjectRunner] Agent fault for ${issue.shortId}: ${note}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
      });
      // Fault sessions still run retro to capture friction and tooling
      // issues. incrementFailure already set the issue to Open/Stuck, so
      // handleRetroExit will finalize without review or close.
      // If no agentSessionId, retro can't run — finalize directly.
      active.workDisposition = Disposition.Fault;
      active.hasCommits = false; // irrelevant for Fault — review is always skipped
    } else {
      // Check for commits since startHead — determines whether we need
      // code review after retro. Retro always runs (even without commits)
      // so we capture friction and tooling issues from research tasks.
      let hasCommits: boolean;
      try {
        hasCommits = await hasNewCommits(cwd, startHead);
      } catch (err) {
        console.error(
          `[ProjectRunner] Git error checking commits for ${issue.shortId}:`,
          err,
        );
        await convex.mutation(api.issues.incrementFailure, {
          issueId,
          maxFailures: this.maxFailures,
        });
        this.finalize();
        return false;
      }

      // Carry forward commit status and disposition so handleRetroExit
      // can decide whether to proceed to review or close directly.
      active.hasCommits = hasCommits;
      active.workDisposition = disposition;
    }

    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Work,
        active.process.pid,
      );
    } catch (err) {
      console.warn(
        `[ProjectRunner] Auto-commit after work failed for ${issue.shortId} — ` +
          "uncommitted changes remain in working tree:",
        err,
      );
    }

    if (active.agentSessionId) {
      await this.startRetro(note);
    } else {
      console.warn(
        `[ProjectRunner] No agentSessionId captured for ${issue.shortId}, skipping retro`,
      );
      try {
        await convex.mutation(api.comments.create, {
          issueId,
          content:
            "Retro skipped — no provider session ID was captured from agent output.",
          author: CommentAuthor.Flux,
        });
      } catch (err) {
        console.error(
          "[ProjectRunner] Failed to create retro-skip comment:",
          err,
        );
      }
      try {
        await active.monitor.cleanupTmpFile();
      } catch {
        // Non-fatal
      }

      if (disposition === Disposition.Fault) {
        // Fault without agentSessionId — can't resume for retro.
        // incrementFailure already set issue to Open/Stuck, just finalize.
        this.finalize();
      } else if (!active.hasCommits) {
        // No agentSessionId (can't resume for retro) and no commits —
        // close directly since there's nothing to review.
        const closeType =
          disposition === Disposition.Noop
            ? CloseType.Noop
            : CloseType.Completed;
        await convex.mutation(api.issues.close, {
          issueId,
          closeType,
          closeReason:
            disposition === Disposition.Noop
              ? note
              : "Work completed without code changes — no review needed.",
        });
        this.finalize();
      } else {
        await this.startReviewLoop();
      }
    }
    return true;
  }

  private async handleRetroExit(): Promise<boolean> {
    const active = this.requireActiveSession("handleRetroExit");
    const { sessionId, issue } = active;
    const convex = getConvexClient();
    const cwd = this.projectPath;

    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Retro,
        active.process.pid,
      );
    } catch (err) {
      console.warn(
        `[ProjectRunner] Auto-commit after retro failed for ${issue.shortId} — ` +
          "uncommitted changes remain in working tree:",
        err,
      );
    }

    // Mark the work session Completed now that retro is done — startRetro
    // re-opened it as Running so the UI could show NudgeInput during retro.
    let endHead: string | undefined;
    try {
      endHead = await getCurrentHead(cwd);
    } catch (err) {
      console.warn(
        `[ProjectRunner] Failed to capture endHead after retro for ${issue.shortId}:`,
        err,
      );
    }
    await convex.mutation(api.sessions.update, {
      sessionId,
      status: SessionStatus.Completed,
      endedAt: Date.now(),
      ...(endHead !== undefined && { endHead }),
    });

    const retroResult = this.resolveDisposition(active);
    if (retroResult.success) {
      await convex.mutation(api.sessions.update, {
        sessionId,
        disposition: retroResult.disposition,
        note: retroResult.note,
      });
    }

    try {
      await active.monitor.cleanupTmpFile();
    } catch {
      // Non-fatal
    }

    // Fault sessions: retro ran to capture friction/tooling insights, but
    // incrementFailure already set the issue to Open/Stuck. Skip review
    // and close — just finalize.
    if (active.workDisposition === Disposition.Fault) {
      this.finalize();
      return true;
    }

    // Determine whether commits exist. Normally carried forward from
    // handleWorkExit, but recovered sessions (adoptOrphanedSession) start
    // with hasCommits=null — compute from git in that case.
    let hasCommits = active.hasCommits;
    if (hasCommits === null) {
      try {
        hasCommits = await hasNewCommits(cwd, active.startHead);
      } catch (err) {
        console.error(
          `[ProjectRunner] Git error checking commits for ${issue.shortId} in handleRetroExit:`,
          err,
        );
        // Can't determine commit state — fall through to review to be safe
        hasCommits = true;
      }
    }

    // No commits → skip code review and close the issue directly.
    // Retro still ran (above) to capture friction/tooling insights.
    if (!hasCommits) {
      const closeType =
        active.workDisposition === Disposition.Noop
          ? CloseType.Noop
          : CloseType.Completed;
      await getConvexClient().mutation(api.issues.close, {
        issueId: active.issueId,
        closeType,
        closeReason:
          active.workDisposition === Disposition.Noop
            ? "No work performed and no commits to review."
            : "Work completed without code changes — no review needed.",
      });
      this.finalize();
      return true;
    }

    await this.startReviewLoop();
    return true;
  }

  private async handleReviewExit(exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handleReviewExit");
    const { sessionId, issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = this.projectPath;

    let endHead: string | undefined;
    try {
      endHead = await getCurrentHead(cwd);
    } catch (err) {
      console.warn(
        `[ProjectRunner] Failed to capture endHead for ${issue.shortId} — session record will omit it:`,
        err,
      );
    }

    const dispositionResult = this.resolveDisposition(active);

    if (active.agentSessionIdPersistFailed && active.agentSessionId) {
      console.warn(
        `[ProjectRunner] Early agentSessionId persist had failed for review of ${issue.shortId} — ` +
          "recovering via handleReviewExit session update.",
      );
    }
    await convex.mutation(api.sessions.update, {
      sessionId,
      status: SessionStatus.Completed,
      endedAt: Date.now(),
      exitCode,
      disposition: dispositionResult.success
        ? dispositionResult.disposition
        : undefined,
      note: dispositionResult.success ? dispositionResult.note : undefined,
      agentSessionId: active.agentSessionId ?? undefined,
      ...(endHead !== undefined && { endHead }),
    });

    if (!dispositionResult.success) {
      console.error(
        `[ProjectRunner] ${StatusMessages.dispositionParseFailed(issue.shortId)}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
        reopenToOpen: false,
      });
      this.finalize();
      return false;
    }

    const { disposition, note } = dispositionResult;

    if (disposition === Disposition.Fault) {
      console.error(
        `[ProjectRunner] Review fault for ${issue.shortId}: ${note}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
        reopenToOpen: false,
      });
      this.finalize();
      return false;
    }

    const newIterations = await convex.mutation(
      api.issues.incrementReviewIterations,
      { issueId },
    );

    if (disposition === Disposition.Noop) {
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Completed,
        closeReason: note || "Review passed clean — no issues found.",
      });
      this.finalize();
      return true;
    }

    let hasCommits: boolean;
    try {
      hasCommits = await hasNewCommits(cwd, startHead);
    } catch (err) {
      console.error(
        `[ProjectRunner] Git error checking commits for ${issue.shortId}:`,
        err,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
        reopenToOpen: false,
      });
      this.finalize();
      return false;
    }

    if (!hasCommits) {
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Completed,
        closeReason:
          note || "Review complete, findings captured as follow-up issues.",
      });
      this.finalize();
      return true;
    }

    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Review,
        active.process.pid,
      );
    } catch (err) {
      console.warn(
        `[ProjectRunner] Auto-commit after review failed for ${issue.shortId} — ` +
          "uncommitted changes remain in working tree:",
        err,
      );
    }

    if (newIterations >= this.maxReviewIterations) {
      console.log(
        `[ProjectRunner] Review iteration limit reached for ${issue.shortId} (${newIterations}/${this.maxReviewIterations}), but disposition is "done" — closing.`,
      );
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Completed,
        closeReason:
          note ||
          `Review passed on final iteration (${newIterations}/${this.maxReviewIterations}) with inline fixes. Closing based on reviewer disposition.`,
      });
      this.finalize();
      return true;
    }

    try {
      await active.monitor.cleanupTmpFile();
    } catch {
      // Non-fatal
    }
    await this.startReviewLoop();
    return true;
  }

  // ── Retro & review lifecycle ─────────────────────────────────────────

  private async startRetro(workNote: string): Promise<void> {
    const active = this.requireActiveSession("startRetro");
    const cwd = this.projectPath;

    const retroPrompt = this.provider.buildRetroPrompt({
      shortId: active.issue.shortId,
      title: active.issue.title,
      workNote,
      customPrompt: this.customRetroPrompt,
    });

    if (!active.agentSessionId) {
      throw new Error(
        `[ProjectRunner] startRetro: agentSessionId is null for ${active.issue.shortId} — ` +
          "cannot resume agent session without a session ID.",
      );
    }

    const retroProcess = this.provider.resume({
      cwd,
      prompt: retroPrompt,
      sessionId: active.agentSessionId,
      phase: SessionPhase.Retro,
      fluxSessionId: active.sessionId,
      fluxIssueId: active.issueId,
      agentName: `${this.provider.name}-retro`,
    });

    const retroMonitor = new SessionMonitor(
      active.sessionId,
      active.monitor.currentSequence,
    );
    retroMonitor.recordInput(retroPrompt);
    const retroMonitorDone = retroMonitor.consume(retroProcess.stdout);

    active.process = retroProcess;
    active.monitor = retroMonitor;
    active.monitorDone = retroMonitorDone;
    active.phase = SessionPhase.Retro;

    this.wireProviderOutput(active, retroMonitor);
    this.emitLifecycle({ type: "monitor_changed", monitor: retroMonitor });

    await getConvexClient().mutation(api.sessions.update, {
      sessionId: active.sessionId,
      phase: SessionPhase.Retro,
      // Restore Running status — handleWorkExit set it to Completed when the
      // work process exited, but the session continues into retro with a new
      // process. Without this, the UI query (getActiveWithIssue) returns null
      // and the NudgeInput disappears.
      status: SessionStatus.Running,
      pid: retroProcess.pid,
      // Clear endedAt so the UI elapsed timer resumes ticking.
      endedAt: null,
    });

    this.trackProcessExit(retroProcess);

    this.startSessionTimeout();
    this.startPidWatchdog();
  }

  private async startReviewLoop(): Promise<void> {
    const active = this.requireActiveSession("startReviewLoop");
    const { issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = this.projectPath;

    const currentIssue = await convex.query(api.issues.get, { issueId });
    const currentIterations = currentIssue?.reviewIterations ?? 0;
    if (currentIterations >= this.maxReviewIterations) {
      console.warn(
        `[ProjectRunner] Review iteration limit reached for ${issue.shortId}`,
      );
      await convex.mutation(api.issues.update, {
        issueId,
        status: IssueStatus.Stuck,
      });
      this.finalize();
      return;
    }

    let diff: string;
    let commitLog: string;
    try {
      diff = await getDiff(cwd, startHead);
      if (!diff) {
        await convex.mutation(api.issues.close, {
          issueId,
          closeType: CloseType.Completed,
          closeReason: "Work completed, no diff to review.",
        });
        this.finalize();
        return;
      }
      commitLog = await getCommitLog(cwd, startHead);
    } catch (err) {
      console.error(
        `[ProjectRunner] Git error building review context for ${issue.shortId}:`,
        err,
      );
      await convex.mutation(api.issues.update, {
        issueId,
        status: IssueStatus.Stuck,
      });
      this.finalize();
      return;
    }

    // Fetch follow-up issues created from this issue to avoid duplicates in review
    const followUpIssues = await convex.query(api.issues.listFollowUps, {
      issueId,
    });
    const relatedIssues = followUpIssues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      status: i.status,
    }));

    // Fetch previous review sessions for this issue to stack context
    const previousReviewSessions = await convex.query(
      api.sessions.listByIssue,
      {
        issueId,
        type: SessionType.Review,
        status: SessionStatus.Completed,
      },
    );

    // Build previousReviews context if we have prior review sessions
    const previousReviews =
      previousReviewSessions.length > 0
        ? await Promise.all(
            previousReviewSessions.map(async (session, idx) => {
              // Fetch issues created during this review session
              const createdIssues = await convex.query(
                api.issues.listBySession,
                { sessionId: session._id },
              );

              // Get commit log for this review iteration
              let reviewCommitLog: string | undefined;
              let commitLogError: string | undefined;
              if (!session.startHead || !session.endHead) {
                commitLogError =
                  "Git commit refs not recorded for this session";
              } else {
                try {
                  reviewCommitLog = await getCommitLogBetween(
                    cwd,
                    session.startHead,
                    session.endHead,
                  );
                } catch (err) {
                  commitLogError = `Failed to retrieve commit log: ${err instanceof Error ? err.message : String(err)}`;
                  console.warn(
                    `[ProjectRunner] Failed to get commit log for review session ${session._id}:`,
                    err,
                  );
                }
              }

              return {
                iteration: idx + 1,
                disposition: session.disposition ?? "unknown",
                note: session.note ?? "No note provided",
                createdIssues: createdIssues.map((i) => ({
                  shortId: i.shortId,
                  title: i.title,
                })),
                commitLog: reviewCommitLog,
                commitLogError,
              };
            }),
          )
        : undefined;

    const reviewPrompt = this.provider.buildReviewPrompt({
      shortId: issue.shortId,
      title: issue.title,
      description: issue.description,
      diff,
      commitLog,
      relatedIssues,
      reviewIteration: currentIterations + 1,
      maxReviewIterations: this.maxReviewIterations,
      previousReviews,
      customPrompt: this.customReviewPrompt,
    });

    const reviewSession = await convex.mutation(api.sessions.create, {
      projectId: this.projectId,
      issueId,
      type: SessionType.Review,
      agent: this.provider.name,
      pid: 0, // Placeholder - will be updated after spawn
      startHead,
      phase: SessionPhase.Review,
    });
    if (!reviewSession) {
      console.error(
        `[ProjectRunner] Failed to create review session for ${issue.shortId}`,
      );
      this.finalize();
      return;
    }

    const reviewProcess = this.provider.spawn({
      cwd,
      prompt: reviewPrompt,
      phase: SessionPhase.Review,
      fluxSessionId: reviewSession._id,
      fluxIssueId: issueId,
      agentName: `${this.provider.name}-review`,
    });

    await convex.mutation(api.sessions.update, {
      sessionId: reviewSession._id,
      pid: reviewProcess.pid,
    });

    const reviewMonitor = new SessionMonitor(reviewSession._id);
    reviewMonitor.recordInput(reviewPrompt);
    const reviewMonitorDone = reviewMonitor.consume(reviewProcess.stdout);

    active.sessionId = reviewSession._id;
    active.process = reviewProcess;
    active.monitor = reviewMonitor;
    active.monitorDone = reviewMonitorDone;
    active.phase = SessionPhase.Review;

    this.wireProviderOutput(active, reviewMonitor);
    this.emitLifecycle({ type: "monitor_changed", monitor: reviewMonitor });

    this.trackProcessExit(reviewProcess);

    this.startSessionTimeout();
    this.startPidWatchdog();
  }

  // ── Scheduling ───────────────────────────────────────────────────────

  private scheduleNext(): void {
    if (this.state !== OrchestratorState.Idle) return;
    if (this.destroyed) return;
    if (this.readyIssues.length === 0) return;

    const issues = [...this.readyIssues];
    const tryNext = async () => {
      for (const issue of issues) {
        try {
          await this.run(issue._id);
          return;
        } catch (err) {
          const isClaim =
            err instanceof Error && err.message.startsWith("Failed to claim");
          if (!isClaim) {
            console.error(
              `[ProjectRunner] Unexpected error running issue ${issue._id}:`,
              err,
            );
            return;
          }
        }
      }
    };
    tryNext();
  }

  /**
   * Finalize the current issue lifecycle. Clears active session and
   * transitions to Idle, then schedules next work.
   */
  private finalize(): void {
    this.clearSessionTimeout();
    this.clearPidWatchdog();
    this.activeSession = null;
    this.state = OrchestratorState.Idle;

    this.emitLifecycle({
      type: "session_end",
      state: OrchestratorState.Idle,
    });

    if (!this.destroyed) {
      this.scheduleNext();
    }
  }

  /**
   * Recover orphaned sessions — running sessions whose PID is no longer alive,
   * or re-adopt live sessions that were orphaned by a process restart.
   */
  private async recoverOrphanedSessions(): Promise<OrphanRecoveryStats> {
    const convex = getConvexClient();
    const sessions = await convex.query(api.sessions.list, {
      projectId: this.projectId,
      status: SessionStatus.Running,
    });

    const stats: OrphanRecoveryStats = {
      deadSessions: 0,
      adoptedSessions: 0,
      orphanedIssues: 0,
    };

    const issuesWithLiveSessions = new Set<string>();
    for (const session of sessions) {
      const pid = session.pid;
      if (pid && isProcessAlive(pid)) {
        issuesWithLiveSessions.add(session.issueId);
      }
    }

    for (const session of sessions) {
      const pid = session.pid;
      const alive = pid ? isProcessAlive(pid) : false;

      if (!alive) {
        stats.deadSessions++;
        await convex.mutation(api.sessions.update, {
          sessionId: session._id,
          status: SessionStatus.Failed,
          endedAt: Date.now(),
          exitCode: -1,
        });
        const issue = await convex.query(api.issues.get, {
          issueId: session.issueId,
        });
        if (issue && issue.status !== IssueStatus.Closed) {
          await convex.mutation(api.issues.update, {
            issueId: session.issueId,
            status: IssueStatus.Open,
            assignee: null,
          });
        }
        continue;
      }

      if (this.activeSession === null) {
        if (!pid) {
          console.error(
            `[ProjectRunner] Cannot re-adopt session ${session._id}: PID is null despite being alive`,
          );
          continue;
        }
        const adopted = await this.adoptOrphanedSession(session, pid);
        if (adopted) {
          stats.adoptedSessions++;
          break;
        }
      }
    }

    stats.orphanedIssues = await this.recoverOrphanedIssues(
      convex,
      issuesWithLiveSessions,
    );

    return stats;
  }

  private async recoverOrphanedIssues(
    convex: ReturnType<typeof getConvexClient>,
    issuesWithLiveSessions: Set<string>,
  ): Promise<number> {
    const inProgressIssues = await convex.query(api.issues.list, {
      projectId: this.projectId,
      status: IssueStatus.InProgress,
    });

    let count = 0;
    for (const issue of inProgressIssues) {
      if (issuesWithLiveSessions.has(issue._id)) continue;

      console.warn(
        `[ProjectRunner] Orphaned issue ${issue.shortId} is in_progress with no active session — reopening`,
      );
      await convex.mutation(api.issues.update, {
        issueId: issue._id,
        status: IssueStatus.Open,
        assignee: null,
      });
      count++;
    }

    return count;
  }

  private async adoptOrphanedSession(
    session: {
      _id: Id<"sessions">;
      issueId: Id<"issues">;
      type: string;
      agent: string;
      phase?: string;
      agentSessionId?: string;
      startHead?: string;
      startedAt: number;
    },
    pid: number,
  ): Promise<boolean> {
    const convex = getConvexClient();

    const issue = await convex.query(api.issues.get, {
      issueId: session.issueId,
    });
    if (!issue) {
      console.error(
        `[ProjectRunner] Cannot re-adopt session ${session._id}: issue ${session.issueId} not found`,
      );
      return false;
    }

    let phase: SessionPhaseValue;
    if (
      session.phase === SessionPhase.Work ||
      session.phase === SessionPhase.Retro ||
      session.phase === SessionPhase.Review
    ) {
      phase = session.phase;
    } else {
      phase =
        session.type === SessionType.Review
          ? SessionPhase.Review
          : SessionPhase.Work;
    }

    console.log(
      `[ProjectRunner] Re-adopting orphaned session ${session._id} (PID ${pid}, phase: ${phase}) for ${issue.shortId}`,
    );

    this.state = OrchestratorState.Busy;

    const stubMonitor = new SessionMonitor(session._id);

    const { promise: exitPromise, resolve: resolveExit } =
      Promise.withResolvers<{ exitCode: number }>();

    const stubProcess: AgentProcess = {
      pid,
      stdout: new ReadableStream<Uint8Array>(),
      stdin: null,
      kill: () => {
        try {
          process.kill(pid);
        } catch {
          // Already dead
        }
      },
      wait: () => exitPromise,
    };

    this.activeSession = {
      sessionId: session._id,
      issueId: session.issueId,
      process: stubProcess,
      monitor: stubMonitor,
      monitorDone: Promise.resolve(),
      killed: false,
      timedOut: false,
      startHead: session.startHead ?? "",
      agentSessionId: session.agentSessionId ?? null,
      agentSessionIdPersistFailed: false,
      issue: {
        shortId: issue.shortId,
        title: issue.title,
        description: issue.description,
      },
      phase,
      timeoutTimer: null,
      structuredOutput: null,
      hasCommits: null,
      workDisposition: null,
    };

    this.emitLifecycle({
      type: "session_start",
      sessionId: session._id,
      issueId: session.issueId,
      pid,
      agent: session.agent,
      monitor: stubMonitor,
    });

    this.pollPidAndHandleExit(
      pid,
      `/tmp/flux-session-${session._id}.log`,
      stubMonitor,
      resolveExit,
    );

    this.trackProcessExit(stubProcess);

    this.startSessionTimeout(session.startedAt);

    return true;
  }

  private pollPidAndHandleExit(
    pid: number,
    tmpPath: string,
    monitor: SessionMonitor,
    resolveExit: (value: { exitCode: number }) => void,
  ): void {
    const interval = setInterval(async () => {
      if (isProcessAlive(pid)) return;

      clearInterval(interval);

      try {
        const logFile = Bun.file(tmpPath);
        if (await logFile.exists()) {
          const text = await logFile.text();
          for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line) as {
                seq: number;
                dir: string;
                ts: number;
                content: string;
              };
              if (entry.dir === SessionEventDirection.Output && entry.content) {
                monitor.buffer.push(entry.content);
              }
            } catch {
              // Malformed log line — skip
            }
          }
        } else {
          console.warn(
            `[ProjectRunner] No tmp log file at ${tmpPath} for re-adopted session`,
          );
        }
      } catch (err) {
        console.error(
          `[ProjectRunner] Failed to read tmp log for re-adopted session:`,
          err,
        );
      }

      resolveExit({ exitCode: -1 });
    }, 2_000);
  }
}

export { ProjectRunner };
export type { OrchestratorLifecycleEvent as ProjectRunnerLifecycleEvent };
export { OrchestratorState } from "@/shared/orchestrator";
