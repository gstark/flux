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
import { readFluxConfig } from "../fluxConfig";
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

/**
 * Parse a cron expression into an approximate interval in milliseconds.
 * Handles common patterns: `@hourly`, `@daily`, `0 *\/N * * *` (every N hours),
 * `*\/N * * * *` (every N minutes), `0 * * * *` (every hour).
 * Returns null for unparseable expressions.
 *
 * This is a pragmatic fallback since Bun's in-process cron API is not yet
 * available in our pinned Bun versions.
 */
function parseCronIntervalMs(schedule: string): number | null {
  const s = schedule.trim();
  if (s === "@hourly") return 60 * 60 * 1000;
  if (s === "@daily" || s === "@midnight") return 24 * 60 * 60 * 1000;

  const parts = s.split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour] = parts;

  // Every N hours: "0 */N * * *" or "* */N * * *"
  const hourStep = hour?.match(/^\*\/(\d+)$/);
  if (hourStep) {
    return Number(hourStep[1]) * 60 * 60 * 1000;
  }

  // Every N minutes: "*/N * * * *"
  const minStep = minute?.match(/^\*\/(\d+)$/);
  if (minStep && hour === "*") {
    return Number(minStep[1]) * 60 * 1000;
  }

  // Fixed minute, any hour: "0 * * * *" (every hour)
  if (hour === "*" && minute !== undefined && /^\d+$/.test(minute)) {
    return 60 * 60 * 1000;
  }

  // Fallback: can't determine interval from complex expressions
  return null;
}

/** Recovery stats returned by orphan recovery on startup. */
export type OrphanRecoveryStats = {
  deadSessions: number;
  adoptedSessions: number;
  orphanedIssues: number;
};

/** Runtime info about the currently active session. */
interface ActiveSession {
  sessionId: Id<"sessions">;
  /** Issue ID — absent for planner sessions */
  issueId?: Id<"issues">;
  process: AgentProcess;
  monitor: SessionMonitor;
  monitorDone: Promise<void>;
  killed: boolean;
  /** Set when the session was killed due to timeout (vs manual kill) */
  timedOut: boolean;
  /** Git HEAD when the work session started (absent for planner sessions) */
  startHead?: string;
  /** Provider-specific session ID captured from agent output */
  agentSessionId: string | null;
  /** True if persisting agentSessionId to Convex failed. A process restart would lose it. */
  agentSessionIdPersistFailed: boolean;
  /** Issue context for prompt building (absent for planner sessions) */
  issue?: WorkPromptContext;
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
      issueId?: string;
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
  /** Custom planner prompt from project config */
  private customPlannerPrompt?: string;
  /** True when a cron tick fired while the runner was busy — planner runs on next idle. */
  private plannerPending = false;
  /** Active Bun.cron reference — cleared on destroy or schedule change. */
  private plannerCronRef: { stop(): void } | null = null;
  /** Current cron schedule from .flux — used to detect changes. */
  private plannerSchedule: string | null = null;

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

  /** Narrowed ActiveSession for issue-based phases (Work/Retro/Review). */
  private requireIssueSession(caller: string): ActiveSession & {
    issueId: Id<"issues">;
    issue: WorkPromptContext;
    startHead: string;
  } {
    const active = this.requireActiveSession(caller);
    if (!active.issueId || !active.issue || active.startHead === undefined) {
      throw new Error(
        `[ProjectRunner] ${caller}: session is not an issue session — missing issueId/issue/startHead.`,
      );
    }
    return active as ActiveSession & {
      issueId: Id<"issues">;
      issue: WorkPromptContext;
      startHead: string;
    };
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
      this.customPlannerPrompt = project.plannerPrompt;
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

    // Configure planner cron from .flux file (if [planner] section present)
    await this.configurePlanner();

    // If planner is overdue (e.g. never run), trigger it now
    if (this.plannerPending && this.state === OrchestratorState.Idle) {
      this.plannerPending = false;
      this.triggerPlanner();
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

    // Stop planner cron
    if (this.plannerCronRef) {
      this.plannerCronRef.stop();
      this.plannerCronRef = null;
    }

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

    // Fetch previous work sessions to give the agent retry awareness
    const allPriorSessions = await convex.query(api.sessions.listByIssue, {
      issueId,
      type: SessionType.Work,
    });
    // Exclude the session we just created; keep only completed/failed
    const priorSessions = allPriorSessions.filter(
      (s) =>
        s._id !== session._id &&
        (s.status === SessionStatus.Completed ||
          s.status === SessionStatus.Failed),
    );

    const previousSessions =
      priorSessions.length > 0
        ? await Promise.all(
            priorSessions.map(async (s) => {
              let commitLog: string | undefined;
              let commitLogError: string | undefined;
              if (!s.startHead || !s.endHead) {
                commitLogError =
                  "Git commit refs not recorded for this session";
              } else {
                try {
                  commitLog = await getCommitLogBetween(
                    cwd,
                    s.startHead,
                    s.endHead,
                  );
                } catch (err) {
                  commitLogError = `Failed to retrieve commit log: ${err instanceof Error ? err.message : String(err)}`;
                }
              }
              return {
                sessionId: s._id,
                phase: s.phase ?? "work",
                disposition: s.disposition ?? "unknown",
                note: s.note ?? "No note provided",
                commitLog,
                commitLogError,
              };
            }),
          )
        : undefined;

    const issueCtx: WorkPromptContext = {
      shortId: issue.shortId,
      title: issue.title,
      description: issue.description,
      comments:
        comments.length > 0
          ? comments.map((c) => ({ author: c.author, content: c.content }))
          : undefined,
      previousSessions,
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
          `[ProjectRunner] Re-adopted session for ${active.issue?.shortId ?? active.sessionId} already exceeded timeout, killing`,
        );
      }
    }

    active.timeoutTimer = setTimeout(() => {
      if (!this.activeSession || this.activeSession.killed) return;

      console.error(
        `[ProjectRunner] Session timeout (${this.sessionTimeoutMs}ms) for ${active.issue?.shortId ?? active.sessionId} phase=${active.phase} — sending SIGTERM`,
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
   * Send a nudge message to the running agent.
   *
   * For agents with stdin support (Claude): delivered as a stream-json user
   * message between turns without interrupting current work.
   *
   * For agents without stdin (OpenCode, Codex): posted as a Convex comment on
   * the active issue. The agent will see it when it next reads issue context.
   *
   * Throws if no active session or write fails.
   */
  async nudge(message: string): Promise<void> {
    if (this.state !== OrchestratorState.Busy || !this.activeSession) {
      throw new Error("No active session to nudge.");
    }

    const { process: agentProcess, monitor, issueId } = this.activeSession;

    // Prefer provider-specific nudge paths when available.
    // OpenCode uses HTTP prompt_async; Pi uses RPC steer over the same hook.
    if (agentProcess.httpNudge && this.activeSession.agentSessionId) {
      await agentProcess.httpNudge(this.activeSession.agentSessionId, message);
      monitor.recordInput(message);
      console.log(
        `[ProjectRunner] Nudge delivered via provider hook to ${this.provider.name} session ${this.activeSession.agentSessionId}`,
      );
      return;
    }

    if (!agentProcess.stdin) {
      // Last resort: post as a Convex comment so the agent sees it next session.
      if (issueId) {
        await getConvexClient().mutation(api.comments.create, {
          issueId,
          content: message,
          author: CommentAuthor.User,
        });
        console.log(
          `[ProjectRunner] Nudge delivered as comment (agent "${this.provider.name}" has no stdin and no active session ID yet)`,
        );
        return;
      }
      throw new Error(
        "Cannot nudge: agent has no stdin, no HTTP API, and session has no issue for comment fallback.",
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
      const cwd = this.projectPath;
      const label = issue?.shortId ?? `session-${sessionId}`;

      // Capture any uncommitted agent work before recording the session end.
      if (issue) {
        try {
          await autoCommitDirtyTree(
            cwd,
            issue.shortId,
            String(sessionId),
            this.activeSession.phase,
          );
        } catch (err) {
          console.warn(
            `[ProjectRunner] Auto-commit after killed session failed for ${label}:`,
            err,
          );
        }
      }

      let endHead: string | undefined;
      try {
        endHead = await getCurrentHead(cwd);
      } catch (err) {
        console.warn(
          `[ProjectRunner] Failed to capture endHead for killed session ${label}:`,
          err,
        );
      }

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
          ...(endHead !== undefined && { endHead }),
        });

        if (timedOut && issueId) {
          console.error(
            `[ProjectRunner] Session timed out for ${label} — incrementing failure count`,
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
      } else if (phase === SessionPhase.Planner) {
        cleanExit = await this.handlePlannerExit(exitCode);
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
      const crashedSession = this.activeSession;
      if (crashedSession) {
        const cwd = this.projectPath;

        // Best-effort auto-commit and endHead capture so retry sessions
        // can see the commit log from this failed attempt.
        if (crashedSession.issue) {
          try {
            await autoCommitDirtyTree(
              cwd,
              crashedSession.issue.shortId,
              String(crashedSession.sessionId),
              crashedSession.phase,
            );
          } catch {
            // Auto-commit failure is non-fatal here — we're already in a crash path.
          }
        }

        let endHead: string | undefined;
        try {
          endHead = await getCurrentHead(cwd);
        } catch {
          // endHead capture failure is non-fatal here.
        }

        try {
          await getConvexClient().mutation(api.sessions.update, {
            sessionId: crashedSession.sessionId,
            status: SessionStatus.Failed,
            endedAt: Date.now(),
            exitCode,
            ...(endHead !== undefined && { endHead }),
          });
        } catch (updateErr) {
          console.error(
            `[ProjectRunner] Failed to mark crashed session ${crashedSession.sessionId} as Failed — ` +
              "will require orphan recovery on next restart:",
            updateErr,
          );
        }
      }
      this.finalize();
    }
  }

  private async handleWorkExit(exitCode: number): Promise<boolean> {
    const active = this.requireIssueSession("handleWorkExit");
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
      const autoCommitted = await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Work,
        active.process.pid,
      );
      // If the auto-commit captured uncommitted work, the session DID produce
      // code changes — even though the agent failed to commit them itself.
      // Update hasCommits so downstream (retro → review) treats this as real
      // work rather than closing as noop and spawning a duplicate issue.
      if (autoCommitted && !active.hasCommits) {
        active.hasCommits = true;
      }
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
    const active = this.requireIssueSession("handleRetroExit");
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
    const active = this.requireIssueSession("handleReviewExit");
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
    const active = this.requireIssueSession("startRetro");
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
    const active = this.requireIssueSession("startReviewLoop");
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

    // Collect follow-up issues from two sources:
    // 1. sourceIssueId linkage (issues explicitly parented to this issue)
    // 2. createdInSessionId linkage (issues created during work/retro sessions)
    // Source (1) requires env var propagation through the MCP stdio bridge, which
    // is unreliable — Claude Code's MCP client may not inherit FLUX_ISSUE_ID.
    // Source (2) is the reliable path since createdInSessionId is set server-side.
    const [followUpBySource, workRetroSessions, reviewComments] =
      await Promise.all([
        convex.query(api.issues.listFollowUps, { issueId }),
        convex.query(api.sessions.listByIssue, { issueId }),
        convex.query(api.comments.list, { issueId }),
      ]);

    // Fetch issues created during each work/retro session
    const sessionIssues = (
      await Promise.all(
        workRetroSessions.map((s) =>
          convex.query(api.issues.listBySession, { sessionId: s._id }),
        ),
      )
    ).flat();

    // Merge and deduplicate by issue ID
    const seen = new Set<string>();
    const relatedIssues: Array<{
      shortId: string;
      title: string;
      status: string;
    }> = [];
    for (const i of [...followUpBySource, ...sessionIssues]) {
      if (seen.has(i._id)) continue;
      seen.add(i._id);
      relatedIssues.push({
        shortId: i.shortId,
        title: i.title,
        status: i.status,
      });
    }

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
      comments:
        reviewComments.length > 0
          ? reviewComments.map((c) => ({
              author: c.author,
              content: c.content,
            }))
          : undefined,
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

  // ── Planner ────────────────────────────────────────────────────────

  /**
   * Read the .flux config from the project path and register/update the
   * planner cron if a [planner] section is present. Called on subscribe()
   * and on each finalize() to pick up config changes.
   */
  async configurePlanner(): Promise<void> {
    const config = await readFluxConfig(this.projectPath);

    const newSchedule = config?.planner?.schedule ?? null;

    // Schedule unchanged — nothing to do
    if (newSchedule === this.plannerSchedule) return;

    // Stop the old cron (if any)
    if (this.plannerCronRef) {
      this.plannerCronRef.stop();
      this.plannerCronRef = null;
      console.log(
        `[ProjectRunner] Stopped planner cron (was: ${this.plannerSchedule})`,
      );
    }

    this.plannerSchedule = newSchedule;

    if (!newSchedule) return;

    // Check if a planner run is overdue (last run older than one interval)
    try {
      const convex = getConvexClient();
      const recent = await convex.query(api.sessions.list, {
        projectId: this.projectId,
        limit: 1,
      });
      const lastPlanner = recent.find((s) => s.type === SessionType.Planner);
      if (!lastPlanner) {
        // Never run — mark pending so we run on next idle
        this.plannerPending = true;
      }
    } catch {
      // Non-fatal — worst case we just wait for the first cron tick
    }

    // Register interval timer based on cron schedule
    const intervalMs = parseCronIntervalMs(newSchedule);
    if (!intervalMs) {
      console.warn(
        `[ProjectRunner] Could not parse planner schedule "${newSchedule}" — skipping cron`,
      );
      return;
    }
    console.log(
      `[ProjectRunner] Registering planner interval (${Math.round(intervalMs / 60_000)}min) from schedule: ${newSchedule}`,
    );
    const timer = setInterval(() => {
      if (this.destroyed) return;
      if (this.state === OrchestratorState.Busy) {
        console.log(
          "[ProjectRunner] Planner timer tick — runner busy, deferring to next idle",
        );
        this.plannerPending = true;
        return;
      }
      this.triggerPlanner();
    }, intervalMs);
    this.plannerCronRef = { stop: () => clearInterval(timer) };
  }

  /**
   * Fire-and-forget planner trigger. Reads fresh agenda from .flux each time.
   */
  private triggerPlanner(): void {
    this.runPlanner().catch((err) =>
      console.error("[ProjectRunner] Planner run failed:", err),
    );
  }

  /**
   * Run a planner session: gather project context, spawn agent, return session info.
   * Follows the same state-locking pattern as run() for issue sessions.
   */
  async runPlanner(): Promise<{ sessionId: Id<"sessions">; pid: number }> {
    if (this.state === OrchestratorState.Busy) {
      throw new Error("Runner is busy. Kill the current session first.");
    }

    this.state = OrchestratorState.Busy;

    try {
      return await this.executePlannerRun();
    } catch (err) {
      this.state = OrchestratorState.Idle;
      throw err;
    }
  }

  private async executePlannerRun(): Promise<{
    sessionId: Id<"sessions">;
    pid: number;
  }> {
    const convex = getConvexClient();

    // Read fresh config for agenda
    const config = await readFluxConfig(this.projectPath);
    const agenda = config?.planner?.agenda;
    if (!agenda) {
      throw new Error(
        "[ProjectRunner] Cannot run planner: no agenda found in .flux [planner] section",
      );
    }

    // Fetch project slug for prompt context
    const project = await convex.query(api.projects.getById, {
      projectId: this.projectId,
    });
    if (!project) {
      throw new Error(
        `[ProjectRunner] Cannot run planner: project ${this.projectId} not found`,
      );
    }

    // Create planner session (no issueId)
    const session = await convex.mutation(api.sessions.create, {
      projectId: this.projectId,
      type: SessionType.Planner,
      agent: this.provider.name,
      pid: 0,
      phase: SessionPhase.Planner,
    });
    if (!session) {
      throw new Error("Failed to create planner session record");
    }

    // Gather planner context
    const [issueCounts, recentSessions] = await Promise.all([
      convex.query(api.issues.counts, { projectId: this.projectId }),
      convex.query(api.sessions.recentForProject, {
        projectId: this.projectId,
        limit: 20,
      }),
    ]);

    const prompt = this.provider.buildPlannerPrompt({
      projectSlug: project.slug,
      agenda,
      issueStats: issueCounts,
      recentSessions,
      customPrompt: this.customPlannerPrompt,
    });

    const cwd = this.projectPath;
    const agentProcess = this.provider.spawn({
      cwd,
      prompt,
      phase: SessionPhase.Planner,
      fluxSessionId: session._id,
      agentName: `${this.provider.name}-planner`,
    });

    // Update session with actual PID
    await convex.mutation(api.sessions.update, {
      sessionId: session._id,
      pid: agentProcess.pid,
    });

    // Start monitoring
    const monitor = new SessionMonitor(session._id);
    monitor.recordInput(prompt);
    const monitorDone = monitor.consume(agentProcess.stdout);

    // Track active session
    const active: ActiveSession = {
      sessionId: session._id,
      process: agentProcess,
      monitor,
      monitorDone,
      killed: false,
      timedOut: false,
      agentSessionId: null,
      agentSessionIdPersistFailed: false,
      phase: SessionPhase.Planner,
      timeoutTimer: null,
      structuredOutput: null,
      hasCommits: null,
      workDisposition: null,
    };
    this.activeSession = active;

    this.emitLifecycle({
      type: "session_start",
      sessionId: session._id,
      pid: agentProcess.pid,
      agent: this.provider.name,
      monitor,
    });

    this.wireProviderOutput(active, monitor);
    this.trackProcessExit(agentProcess);
    this.startSessionTimeout();
    this.startPidWatchdog();

    return { sessionId: session._id, pid: agentProcess.pid };
  }

  /**
   * Handle planner session exit. Simple: resolve disposition, update session, finalize.
   * No retro/review chain, no git tracking, no issue state changes.
   */
  private async handlePlannerExit(exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handlePlannerExit");
    const { sessionId } = active;
    const convex = getConvexClient();

    const dispositionResult = this.resolveDisposition(active);
    if (dispositionResult.success) {
      const { disposition, note } = dispositionResult;
      console.log(
        `[ProjectRunner] Planner session ${sessionId}: ${disposition} — ${note}`,
      );
      await convex.mutation(api.sessions.update, {
        sessionId,
        status: SessionStatus.Completed,
        endedAt: Date.now(),
        exitCode,
        disposition,
        note,
      });
    } else {
      console.error(
        `[ProjectRunner] Planner disposition parse failed: ${dispositionResult.error}`,
      );
      await convex.mutation(api.sessions.update, {
        sessionId,
        status: exitCode === 0 ? SessionStatus.Completed : SessionStatus.Failed,
        endedAt: Date.now(),
        exitCode,
        disposition: Disposition.Fault,
        note: dispositionResult.error,
      });
    }

    this.finalize();
    return true;
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

    if (this.destroyed) return;

    // Re-read .flux config on each idle transition to pick up schedule/agenda changes
    this.configurePlanner().catch((err) =>
      console.error("[ProjectRunner] configurePlanner() failed on idle:", err),
    );

    // If a planner cron tick fired while busy, run the planner now before picking up issues
    if (this.plannerPending) {
      this.plannerPending = false;
      this.triggerPlanner();
      return;
    }

    this.scheduleNext();
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
      if (pid && isProcessAlive(pid) && session.issueId) {
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
        // Planner sessions have no issue — skip issue recovery
        if (session.issueId) {
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
      issueId?: Id<"issues">;
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

    // Planner sessions have no issue — can't be re-adopted
    if (!session.issueId) {
      console.log(
        `[ProjectRunner] Skipping re-adoption of issueless session ${session._id} (PID ${pid})`,
      );
      return false;
    }

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
      httpNudge: null,
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
