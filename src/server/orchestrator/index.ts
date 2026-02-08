import {
  type OrchestratorActiveSession,
  OrchestratorState,
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
  getCurrentHead,
  getDiff,
  hasNewCommits,
  resolveRepoRoot,
} from "../git";
import { isProcessAlive } from "../process";
import type { AgentProcess, AgentProvider, WorkPromptContext } from "./agents";
import {
  ClaudeCodeProvider,
  Disposition,
  parseDisposition,
  StatusMessages,
} from "./agents";
import { SessionMonitor } from "./monitor";

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
  /** Claude session UUID captured from stream-json output */
  agentSessionId: string | null;
  /** Issue context for prompt building */
  issue: WorkPromptContext;
  /** Current phase of the issue lifecycle */
  phase: SessionPhaseValue;
  /** Handle for the session timeout timer (cleared on normal exit) */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Lifecycle event emitted by the Orchestrator when session state changes.
 * SSE clients subscribe to these to know when to start/stop piping monitor output.
 */
export type OrchestratorLifecycleEvent =
  | {
      type: "session_start";
      sessionId: string;
      issueId: string;
      pid: number;
      monitor: SessionMonitor;
    }
  | {
      type: "session_end";
      state: Exclude<OrchestratorState, "busy">;
    }
  | {
      type: "monitor_changed";
      monitor: SessionMonitor;
    };

/** Orchestrator manages claiming issues, spawning agents, and session lifecycle. */
class Orchestrator {
  private state: OrchestratorState = OrchestratorState.Stopped;
  private activeSession: ActiveSession | null = null;
  private provider: AgentProvider;
  private projectId: Id<"projects">;
  private unsubscribeReady: (() => void) | null = null;
  private pendingStop = false;
  private readyIssues: Array<{ _id: Id<"issues"> }> = [];
  private maxFailures = 3;
  private maxReviewIterations = 10;
  private sessionTimeoutMs = 30 * 60 * 1000; // 30 minutes default
  private pidWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleListeners = new Set<
    (event: OrchestratorLifecycleEvent) => void
  >();

  constructor(projectId: Id<"projects">, provider?: AgentProvider) {
    this.projectId = projectId;
    this.provider = provider ?? new ClaudeCodeProvider();
  }

  /**
   * Assert that activeSession is set, returning the narrowed type.
   * Throws immediately if null — fail fast per 'No Silent Fallbacks'.
   */
  private requireActiveSession(caller: string): ActiveSession {
    if (!this.activeSession) {
      throw new Error(
        `[Orchestrator] ${caller}: activeSession is null — this is a bug. ` +
          "The orchestrator should never reach this point without an active session.",
      );
    }
    return this.activeSession;
  }

  getStatus(): {
    state: OrchestratorState;
    schedulerEnabled: boolean;
    readyCount: number;
    activeSession: OrchestratorActiveSession | null;
  } {
    return {
      state: this.state,
      schedulerEnabled: this.unsubscribeReady !== null,
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
          `[Orchestrator] Lifecycle listener threw on ${event.type} — removing:`,
          err,
        );
        this.lifecycleListeners.delete(listener);
      }
    }
  }

  /**
   * Enable the auto-scheduler: persist config, recover orphans, subscribe to ready issues.
   * Transitions from Stopped → Idle and begins watching for work.
   */
  async enable(): Promise<void> {
    if (this.state === OrchestratorState.Busy) {
      throw new Error(
        "Cannot enable scheduler while busy. Wait for current session to complete.",
      );
    }

    const convex = getConvexClient();

    // Persist to DB (upsert handled by the mutation)
    await convex.mutation(api.orchestratorConfig.enable, {
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
    await this.recoverOrphanedSessions();

    // Subscribe to ready issues
    this.pendingStop = false;
    this.unsubscribeReady = convex.onUpdate(
      api.issues.ready,
      { projectId: this.projectId, maxFailures: this.maxFailures },
      (issues) => {
        this.readyIssues = issues;
        this.scheduleNext();
      },
    );

    this.state = OrchestratorState.Idle;
  }

  /**
   * Stop the auto-scheduler. Unsubscribes from ready issues and persists config.
   * If busy, sets pendingStop so the current session finishes before transitioning to Stopped.
   */
  async stop(): Promise<void> {
    // Unsubscribe first
    if (this.unsubscribeReady) {
      this.unsubscribeReady();
      this.unsubscribeReady = null;
    }
    this.readyIssues = [];

    const convex = getConvexClient();
    await convex.mutation(api.orchestratorConfig.disable, {
      projectId: this.projectId,
    });

    if (this.state === OrchestratorState.Busy) {
      // Let the current session finish, then transition to stopped
      this.pendingStop = true;
    } else {
      this.state = OrchestratorState.Stopped;
      this.pendingStop = false;
    }
  }

  /**
   * Run a single issue: claim → spawn agent → return immediately.
   * Agent exit is handled in the background via fire-and-forget.
   * Throws if orchestrator is already busy or claim fails.
   */
  async run(
    issueId: Id<"issues">,
  ): Promise<{ sessionId: Id<"sessions">; pid: number }> {
    if (this.state === OrchestratorState.Busy) {
      throw new Error("Orchestrator is busy. Kill the current session first.");
    }

    // Lock immediately to prevent re-entrant spawns from subscription callbacks.
    // The onUpdate subscription can fire between any two awaits, and scheduleNext()
    // checks this guard synchronously. Without this, multiple agents spawn in parallel.
    const previousState = this.state;
    this.state = OrchestratorState.Busy;

    try {
      return await this.executeRun(issueId);
    } catch (err) {
      // Restore previous state so the scheduler can retry with the next issue
      this.state = previousState;
      throw err;
    }
  }

  private async executeRun(
    issueId: Id<"issues">,
  ): Promise<{ sessionId: Id<"sessions">; pid: number }> {
    const convex = getConvexClient();

    // 1. Claim the issue atomically
    const claimResult = await convex.mutation(api.issues.claim, {
      issueId,
      assignee: this.provider.name,
    });

    if (!claimResult.success) {
      throw new Error(`Failed to claim issue: ${claimResult.reason}`);
    }
    const issue = claimResult.issue;

    // 2. Resolve repo root for cwd
    const cwd = await resolveRepoRoot();

    // 3. Record startHead before spawning
    const startHead = await getCurrentHead(cwd);

    // 4. Auto-commit dirty tree before starting work (non-blocking)
    try {
      await autoCommitDirtyTree(cwd, issue.shortId, "pre-session");
    } catch (err) {
      console.error("[Orchestrator] Auto-commit before session failed:", err);
    }

    // 5. Build prompt and spawn agent
    const issueCtx: WorkPromptContext = {
      shortId: issue.shortId,
      title: issue.title,
      description: issue.description,
    };
    const prompt = this.provider.buildWorkPrompt(issueCtx);
    const agentProcess = this.provider.spawn({ cwd, prompt });

    // 6. Create session record with startHead
    const session = await convex.mutation(api.sessions.create, {
      projectId: this.projectId,
      issueId,
      type: SessionType.Work,
      agent: this.provider.name,
      pid: agentProcess.pid,
      startHead,
      phase: SessionPhase.Work,
    });
    if (!session) {
      agentProcess.kill();
      throw new Error("Failed to create session record");
    }

    // 7. Start monitoring agent output
    const monitor = new SessionMonitor(session._id, this.projectId);
    monitor.recordInput(prompt);
    const monitorDone = monitor.consume(agentProcess.stdout);

    // 8. Track active session
    this.activeSession = {
      sessionId: session._id,
      issueId,
      process: agentProcess,
      monitor,
      monitorDone,
      killed: false,
      timedOut: false,
      startHead,
      agentSessionId: null,
      issue: issueCtx,
      phase: SessionPhase.Work,
      timeoutTimer: null,
    };

    // 9. Notify SSE clients of the new session
    this.emitLifecycle({
      type: "session_start",
      sessionId: session._id,
      issueId,
      pid: agentProcess.pid,
      monitor,
    });

    // 10. Wire up agentSessionId extraction from stream-json
    const activeRef = this.activeSession;
    monitor.onLine((line) => {
      if (activeRef.agentSessionId) return; // Already captured
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === "system" && typeof obj.session_id === "string") {
          activeRef.agentSessionId = obj.session_id;
          // Persist immediately so it survives hot reloads. Without this,
          // a module re-evaluation loses the in-memory value and re-adopted
          // sessions can't resume for retro.
          getConvexClient()
            .mutation(api.sessions.update, {
              sessionId: activeRef.sessionId,
              agentSessionId: obj.session_id,
            })
            .catch((err: unknown) =>
              console.error(
                "[Orchestrator] Failed to persist agentSessionId:",
                err,
              ),
            );
        }
      } catch {
        // Not JSON — ignore
      }
    });

    // 11. Fire-and-forget: handle agent exit in background
    agentProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );

    // 12. Start session timeout enforcement
    this.startSessionTimeout();

    // 13. Start PID watchdog to detect silently-dead processes (e.g. laptop sleep)
    this.startPidWatchdog();

    return { sessionId: session._id, pid: agentProcess.pid };
  }

  // ── Session timeout enforcement ───────────────────────────────────

  /**
   * Start a timeout timer for the active session. On timeout:
   * 1. SIGTERM (graceful shutdown attempt)
   * 2. Wait 10 seconds
   * 3. SIGKILL if still running
   * 4. handleExit runs with timedOut=true → session failed, disposition "fault"
   *
   * @param startedAt - If provided (e.g., re-adopted sessions), calculates
   *   remaining time from when the session originally started.
   */
  private startSessionTimeout(startedAt?: number): void {
    const active = this.requireActiveSession("startSessionTimeout");

    // Clear any existing timer (e.g., phase transition)
    this.clearSessionTimeout();

    // Calculate delay: full timeout for new sessions, remaining time for re-adopted
    let delay = this.sessionTimeoutMs;
    if (startedAt !== undefined) {
      const elapsed = Date.now() - startedAt;
      delay = Math.max(0, this.sessionTimeoutMs - elapsed);
      if (delay === 0) {
        // Already timed out — kill immediately
        console.warn(
          `[Orchestrator] Re-adopted session for ${active.issue.shortId} already exceeded timeout, killing`,
        );
      }
    }

    active.timeoutTimer = setTimeout(() => {
      if (!this.activeSession || this.activeSession.killed) return;

      console.error(
        `[Orchestrator] Session timeout (${this.sessionTimeoutMs}ms) for ${active.issue.shortId} phase=${active.phase} — sending SIGTERM`,
      );

      this.activeSession.timedOut = true;
      this.activeSession.killed = true;

      // SIGTERM first (graceful)
      this.activeSession.process.kill();

      // SIGKILL after 10s if still running
      const pid = this.activeSession.process.pid;
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          console.error(
            `[Orchestrator] Agent PID ${pid} still alive after 10s grace period — sending SIGKILL`,
          );
          try {
            process.kill(pid, 9); // SIGKILL
          } catch {
            // Already dead — race between natural exit and our kill
          }
        }
      }, 10_000);
    }, delay);
  }

  /** Clear the session timeout timer (called on normal exit or manual kill). */
  private clearSessionTimeout(): void {
    if (this.activeSession?.timeoutTimer) {
      clearTimeout(this.activeSession.timeoutTimer);
      this.activeSession.timeoutTimer = null;
    }
  }

  // ── PID watchdog ────────────────────────────────────────────────────

  /** Interval between PID liveness checks (15 seconds). */
  private static readonly PID_WATCHDOG_INTERVAL_MS = 15_000;

  /**
   * Start a periodic PID liveness check. Detects silently-dead agent processes
   * (e.g. OS killed child during laptop sleep but exit event was never delivered).
   * Reads activeSession.process.pid each tick, so phase transitions that replace
   * the process are tracked automatically.
   */
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
          `[Orchestrator] PID watchdog: process ${pid} is dead, triggering handleExit(-1)`,
        );
        this.handleExit(-1);
      }
    }, Orchestrator.PID_WATCHDOG_INTERVAL_MS);
  }

  /** Clear the PID watchdog timer. */
  private clearPidWatchdog(): void {
    if (this.pidWatchdogTimer) {
      clearInterval(this.pidWatchdogTimer);
      this.pidWatchdogTimer = null;
    }
  }

  /**
   * Kill the running agent immediately.
   * The exit handler will detect the `killed` flag and apply hand-off semantics:
   * issue stays in_progress, session marked as failed.
   */
  async kill(): Promise<void> {
    if (this.state !== OrchestratorState.Busy || !this.activeSession) {
      throw new Error("No active session to kill.");
    }

    // Clear timeout timer and PID watchdog — manual kill takes precedence
    this.clearSessionTimeout();
    this.clearPidWatchdog();

    // Mark as killed so the exit handler knows this was intentional
    this.activeSession.killed = true;
    this.activeSession.process.kill();

    // Exit handler (handleExit) will run when the process actually terminates
    // and will apply kill-specific finalization (hand-off semantics).
  }

  // ── Exit handling ────────────────────────────────────────────────────

  /**
   * Handle agent process exit. Routes to the appropriate phase handler.
   * Called from the fire-and-forget .then() chain on agentProcess.wait().
   */
  private async handleExit(exitCode: number): Promise<void> {
    if (!this.activeSession) return;

    // Clear session timeout timer — the process has exited
    this.clearSessionTimeout();

    // Clear PID watchdog — no longer needed once exit is being handled
    this.clearPidWatchdog();

    // Wait for monitor to finish draining stdout before finalizing
    try {
      await this.activeSession.monitorDone;
    } catch (err) {
      console.error("[Orchestrator] Monitor drain error:", err);
    }
    await this.activeSession.monitor.shutdown();

    // Capture monitor ref before phase handlers call finalize() (which nulls activeSession)
    const monitor = this.activeSession.monitor;

    // Kill path: session was terminated externally (manual kill or timeout).
    // Keep tmp file for debugging.
    if (this.activeSession.killed) {
      const convex = getConvexClient();
      const { sessionId, issueId, timedOut, issue } = this.activeSession;

      await convex.mutation(api.sessions.update, {
        sessionId,
        status: SessionStatus.Failed,
        endedAt: Date.now(),
        exitCode,
        // Timeout kills get an explicit fault disposition for traceability
        disposition: timedOut ? Disposition.Fault : undefined,
        note: timedOut
          ? `Session timed out after ${this.sessionTimeoutMs}ms (phase: ${this.activeSession.phase})`
          : undefined,
      });

      // Timeout: increment failure count so the circuit breaker can trip.
      // Manual kills leave the issue in_progress for human review.
      if (timedOut) {
        console.error(
          `[Orchestrator] Session timed out for ${issue.shortId} — incrementing failure count`,
        );
        await convex.mutation(api.issues.incrementFailure, {
          issueId,
          maxFailures: this.maxFailures,
        });
      }

      this.finalize();
      return;
    }

    // Route to phase-specific handler.
    // CRITICAL: finalize() MUST run regardless of errors, otherwise the orchestrator
    // wedges in Busy state forever. Any throw in a phase handler that skips finalize()
    // means the scheduler stops picking up new work.
    try {
      const { phase } = this.activeSession;
      let cleanExit = false;
      if (phase === SessionPhase.Work) {
        cleanExit = await this.handleWorkExit(exitCode);
      } else if (phase === SessionPhase.Retro) {
        cleanExit = await this.handleRetroExit(exitCode);
      } else if (phase === SessionPhase.Review) {
        cleanExit = await this.handleReviewExit(exitCode);
      }
      // Only clean up tmp file on success — keep on failure for debugging.
      // Isolated try-catch: a filesystem error here must NOT propagate to
      // the outer catch, which calls finalize() — that would orphan an
      // in-flight retro/review session.
      // Guard: only clean up if the lifecycle ended (finalize ran). When
      // work→retro or retro→review transitions occur, activeSession is still
      // set — the new phase's monitor may share the same tmp path (retro
      // reuses the work session ID). Cleaning here would delete its active file.
      if (cleanExit && this.activeSession === null) {
        try {
          await monitor.cleanupTmpFile();
        } catch (cleanupErr) {
          console.error(
            "[Orchestrator] tmp file cleanup failed (non-fatal):",
            cleanupErr,
          );
        }
      }
    } catch (err) {
      // Exit handler crashed — keep tmp file for debugging
      console.error(
        "[Orchestrator] Exit handler crashed — forcing finalize:",
        err,
      );
      this.finalize();
    }
  }

  /**
   * Handle work session exit. Implements the worker session inference table:
   *
   * | Disposition | Commits? | Action                                    |
   * |-------------|----------|-------------------------------------------|
   * | malformed   | —        | incrementFailure, reopen (circuit breaker) |
   * | fault       | —        | incrementFailure, reopen (circuit breaker) |
   * | noop        | —        | close as noop                              |
   * | done        | No       | close as noop                              |
   * | done        | Yes      | auto-commit → retro → review               |
   */
  private async handleWorkExit(exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handleWorkExit");
    const { sessionId, issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = await resolveRepoRoot();

    // Capture endHead (fallback to startHead if git fails)
    let endHead: string;
    try {
      endHead = await getCurrentHead(cwd);
    } catch {
      endHead = startHead;
    }

    // Parse disposition from monitor buffer
    const allLines = active.monitor.buffer.getAll();
    const dispositionResult = parseDisposition(allLines);

    // Update session record
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
      endHead,
    });

    // ── Malformed: no valid disposition parsed ──
    if (!dispositionResult.success) {
      console.error(
        `[Orchestrator] ${StatusMessages.dispositionParseFailed(issue.shortId)}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
      });
      this.finalize();
      return false;
    }

    const { disposition, note } = dispositionResult;

    // ── Fault ──
    if (disposition === Disposition.Fault) {
      console.error(`[Orchestrator] Agent fault for ${issue.shortId}: ${note}`);
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
      });
      this.finalize();
      return false;
    }

    // ── Noop ──
    if (disposition === Disposition.Noop) {
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Noop,
        closeReason: note,
      });
      this.finalize();
      return true;
    }

    // ── Done: check for commits ──
    let hasCommits: boolean;
    try {
      hasCommits = await hasNewCommits(cwd, startHead);
    } catch (err) {
      console.error(
        `[Orchestrator] Git error checking commits for ${issue.shortId}:`,
        err,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
      });
      this.finalize();
      return false;
    }

    if (!hasCommits) {
      // Agent said done but made no commits — treat as noop
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Noop,
        closeReason: note,
      });
      this.finalize();
      return true;
    }

    // Done with commits — auto-commit dirty tree, then proceed to retro
    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Work,
        active.process.pid,
      );
    } catch (err) {
      console.error("[Orchestrator] Auto-commit after work failed:", err);
    }

    // Proceed to retro if we can resume, otherwise skip to review
    if (active.agentSessionId) {
      await this.startRetro(note);
    } else {
      console.warn(
        `[Orchestrator] No agentSessionId captured for ${issue.shortId}, skipping retro`,
      );
      // Record the skip as a comment on the issue for traceability
      try {
        await convex.mutation(api.comments.create, {
          issueId,
          content:
            "Retro skipped — no agent session ID captured from stream-json output.",
          author: CommentAuthor.Flux,
        });
      } catch (err) {
        console.error(
          "[Orchestrator] Failed to create retro-skip comment:",
          err,
        );
      }
      // Review creates a new session (different tmp path). Clean up work
      // tmp file now — it would otherwise be orphaned.
      try {
        await active.monitor.cleanupTmpFile();
      } catch {
        // Non-fatal: best-effort cleanup
      }
      await this.startReviewLoop();
    }
    return true;
  }

  /**
   * Handle retro session exit. Retro is advisory — never blocks the pipeline.
   * Always proceeds to review regardless of retro outcome.
   */
  private async handleRetroExit(_exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handleRetroExit");
    const { sessionId, issue } = active;
    const convex = getConvexClient();
    const cwd = await resolveRepoRoot();

    // Auto-commit any retro changes (e.g., friction fixes)
    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Retro,
        active.process.pid,
      );
    } catch (err) {
      console.error("[Orchestrator] Auto-commit after retro failed:", err);
    }

    // Update session endHead after retro
    try {
      const endHead = await getCurrentHead(cwd);
      await convex.mutation(api.sessions.update, {
        sessionId,
        endHead,
      });
    } catch (err) {
      console.error("[Orchestrator] Post-retro endHead update failed:", err);
    }

    // Parse retro disposition for logging (but don't act on it)
    const allLines = active.monitor.buffer.getAll();
    const retroResult = parseDisposition(allLines);
    if (retroResult.success) {
      await convex.mutation(api.sessions.update, {
        sessionId,
        disposition: retroResult.disposition,
        note: retroResult.note,
      });
    }

    // Always proceed to review, regardless of retro outcome
    // Review creates a new session (different tmp path). Clean up the
    // work/retro tmp file now — it would otherwise be orphaned.
    try {
      await active.monitor.cleanupTmpFile();
    } catch {
      // Non-fatal: best-effort cleanup
    }
    await this.startReviewLoop();
    return true;
  }

  /**
   * Handle review session exit. Implements the review session inference table:
   *
   * | Disposition | Commits? | Action                                          |
   * |-------------|----------|-------------------------------------------------|
   * | malformed   | —        | incrementFailure                                |
   * | fault       | —        | incrementFailure                                |
   * | noop        | —        | incrementReviewIterations, close as completed    |
   * | done        | No       | incrementReviewIterations, close as completed    |
   * | done        | Yes      | incrementReviewIterations, loop or mark stuck    |
   */
  private async handleReviewExit(exitCode: number): Promise<boolean> {
    const active = this.requireActiveSession("handleReviewExit");
    const { sessionId, issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = await resolveRepoRoot();

    // Capture endHead
    let endHead: string;
    try {
      endHead = await getCurrentHead(cwd);
    } catch {
      endHead = startHead;
    }

    // Parse review disposition
    const allLines = active.monitor.buffer.getAll();
    const dispositionResult = parseDisposition(allLines);

    // Update review session record
    await convex.mutation(api.sessions.update, {
      sessionId,
      status: SessionStatus.Completed,
      endedAt: Date.now(),
      exitCode,
      disposition: dispositionResult.success
        ? dispositionResult.disposition
        : undefined,
      note: dispositionResult.success ? dispositionResult.note : undefined,
      endHead,
    });

    // ── Malformed or Fault: increment failure, leave issue in_progress ──
    // reopenToOpen: false — review failures should NOT reopen to open,
    // they leave the issue in_progress (unless circuit breaker trips → stuck)
    if (!dispositionResult.success) {
      console.error(
        `[Orchestrator] ${StatusMessages.dispositionParseFailed(issue.shortId)}`,
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
        `[Orchestrator] Review fault for ${issue.shortId}: ${note}`,
      );
      await convex.mutation(api.issues.incrementFailure, {
        issueId,
        maxFailures: this.maxFailures,
        reopenToOpen: false,
      });
      this.finalize();
      return false;
    }

    // ── Done or Noop: increment review iterations ──
    const newIterations = await convex.mutation(
      api.issues.incrementReviewIterations,
      { issueId },
    );

    // ── Noop: clean pass — close as completed ──
    if (disposition === Disposition.Noop) {
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Completed,
        closeReason: note || "Review passed clean — no issues found.",
      });
      this.finalize();
      return true;
    }

    // ── Done: check for new commits ──
    let hasCommits: boolean;
    try {
      hasCommits = await hasNewCommits(cwd, startHead);
    } catch (err) {
      console.error(
        `[Orchestrator] Git error checking commits for ${issue.shortId}:`,
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
      // Review done, no inline fixes — findings became follow-up issues
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: CloseType.Completed,
        closeReason:
          note || "Review complete, findings captured as follow-up issues.",
      });
      this.finalize();
      return true;
    }

    // Review made commits — auto-commit dirty tree
    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        SessionPhase.Review,
        active.process.pid,
      );
    } catch (err) {
      console.error("[Orchestrator] Auto-commit after review failed:", err);
    }

    // Check iteration limit
    if (newIterations >= this.maxReviewIterations) {
      // Reviewer said "done" — trust the disposition and close, even though
      // inline fixes can't be verified with another pass. Marking stuck here
      // penalises reviews that made trivial last-iteration fixes.
      console.log(
        `[Orchestrator] Review iteration limit reached for ${issue.shortId} (${newIterations}/${this.maxReviewIterations}), but disposition is "done" — closing.`,
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

    // Loop: start another review
    // Review loop creates a new session (different tmp path). Clean up the
    // current review's tmp file now — it would otherwise be orphaned.
    try {
      await active.monitor.cleanupTmpFile();
    } catch {
      // Non-fatal: best-effort cleanup
    }
    await this.startReviewLoop();
    return true;
  }

  // ── Retro & review lifecycle ─────────────────────────────────────────

  /**
   * Start the retro phase by resuming the agent session.
   * Retro is advisory — the agent reflects and may create follow-up issues.
   */
  private async startRetro(workNote: string): Promise<void> {
    const active = this.requireActiveSession("startRetro");
    const cwd = await resolveRepoRoot();

    const retroPrompt = this.provider.buildRetroPrompt({
      shortId: active.issue.shortId,
      title: active.issue.title,
      workNote,
    });

    if (!active.agentSessionId) {
      throw new Error(
        `[Orchestrator] startRetro: agentSessionId is null for ${active.issue.shortId} — ` +
          "cannot resume agent session without a session ID.",
      );
    }

    // Resume the same agent session for retro
    const retroProcess = this.provider.resume({
      cwd,
      prompt: retroPrompt,
      sessionId: active.agentSessionId,
    });

    // Create a new monitor for the retro output, continuing sequence from work monitor
    // Note: We reuse the same session record — retro is part of the work session
    const retroMonitor = new SessionMonitor(
      active.sessionId,
      this.projectId,
      active.monitor.currentSequence,
    );
    retroMonitor.recordInput(retroPrompt);
    const retroMonitorDone = retroMonitor.consume(retroProcess.stdout);

    // Update active session for retro phase
    active.process = retroProcess;
    active.monitor = retroMonitor;
    active.monitorDone = retroMonitorDone;
    active.phase = SessionPhase.Retro;

    // Notify SSE clients about the new monitor
    this.emitLifecycle({ type: "monitor_changed", monitor: retroMonitor });

    // Persist phase transition so re-adoption can route correctly
    await getConvexClient().mutation(api.sessions.update, {
      sessionId: active.sessionId,
      phase: SessionPhase.Retro,
    });

    // Fire-and-forget: handle retro exit
    retroProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );

    // Restart timeout and PID watchdog for the new phase
    this.startSessionTimeout();
    this.startPidWatchdog();
  }

  /**
   * Start a review loop iteration. Spawns a fresh stateless review session
   * with diff and related issues context.
   */
  private async startReviewLoop(): Promise<void> {
    const active = this.requireActiveSession("startReviewLoop");
    const { issueId, startHead, issue } = active;
    const convex = getConvexClient();
    const cwd = await resolveRepoRoot();

    // Check iteration limit before starting
    const currentIssue = await convex.query(api.issues.get, { issueId });
    const currentIterations = currentIssue?.reviewIterations ?? 0;
    if (currentIterations >= this.maxReviewIterations) {
      console.warn(
        `[Orchestrator] Review iteration limit reached for ${issue.shortId}`,
      );
      await convex.mutation(api.issues.update, {
        issueId,
        status: IssueStatus.Stuck,
      });
      this.finalize();
      return;
    }

    // Build review context
    let diff: string;
    let commitLog: string;
    try {
      diff = await getDiff(cwd, startHead);
      if (!diff) {
        // No diff means no changes to review — close as completed
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
        `[Orchestrator] Git error building review context for ${issue.shortId}:`,
        err,
      );
      await convex.mutation(api.issues.update, {
        issueId,
        status: IssueStatus.Stuck,
      });
      this.finalize();
      return;
    }

    // Build related issues summary (issues created during retro/reviews)
    // TODO: Add issues.listBySource query when sourceIssueId filtering is available
    const relatedIssues: Array<{
      shortId: string;
      title: string;
      status: string;
    }> = [];

    const reviewPrompt = this.provider.buildReviewPrompt({
      shortId: issue.shortId,
      title: issue.title,
      description: issue.description,
      diff,
      commitLog,
      relatedIssues,
      reviewIteration: currentIterations + 1,
      maxReviewIterations: this.maxReviewIterations,
    });

    // Spawn a fresh (stateless) review session
    const reviewProcess = this.provider.spawn({ cwd, prompt: reviewPrompt });

    // Create a new session record for the review
    const reviewSession = await convex.mutation(api.sessions.create, {
      projectId: this.projectId,
      issueId,
      type: SessionType.Review,
      agent: this.provider.name,
      pid: reviewProcess.pid,
      startHead,
      phase: SessionPhase.Review,
    });
    if (!reviewSession) {
      reviewProcess.kill();
      console.error(
        `[Orchestrator] Failed to create review session for ${issue.shortId}`,
      );
      this.finalize();
      return;
    }

    // Monitor review output
    const reviewMonitor = new SessionMonitor(reviewSession._id, this.projectId);
    reviewMonitor.recordInput(reviewPrompt);
    const reviewMonitorDone = reviewMonitor.consume(reviewProcess.stdout);

    // Update active session to track the review
    active.sessionId = reviewSession._id;
    active.process = reviewProcess;
    active.monitor = reviewMonitor;
    active.monitorDone = reviewMonitorDone;
    active.phase = SessionPhase.Review;

    // Notify SSE clients about the new monitor
    this.emitLifecycle({ type: "monitor_changed", monitor: reviewMonitor });

    // No phase persistence needed here — sessions.create above already
    // set phase: SessionPhase.Review on the new record.

    // Fire-and-forget: handle review exit
    reviewProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );

    // Restart timeout and PID watchdog for the new phase
    this.startSessionTimeout();
    this.startPidWatchdog();
  }

  // ── Scheduling ───────────────────────────────────────────────────────

  /**
   * Try to pick up the next ready issue. No-op if not idle or queue is empty.
   * Iterates through ready issues until one claim succeeds (others may be race-lost).
   */
  private scheduleNext(): void {
    if (this.state !== OrchestratorState.Idle) return;
    if (this.readyIssues.length === 0) return;

    // Try each ready issue until one claim succeeds (others may race)
    const issues = [...this.readyIssues];
    const tryNext = async () => {
      for (const issue of issues) {
        try {
          await this.run(issue._id);
          return; // Successfully started
        } catch (err) {
          const isClaim =
            err instanceof Error && err.message.startsWith("Failed to claim");
          if (!isClaim) {
            console.error(
              `[Orchestrator] Unexpected error running issue ${issue._id}:`,
              err,
            );
            return; // Stop trying — something is broken
          }
          // Claim race lost — try the next issue
        }
      }
    };
    tryNext();
  }

  /**
   * Finalize the current issue lifecycle. Clears active session and transitions
   * state based on pendingStop and subscription status.
   */
  private finalize(): void {
    // Clear PID watchdog before nulling the session
    this.clearPidWatchdog();

    this.activeSession = null;

    if (this.pendingStop || !this.unsubscribeReady) {
      this.state = OrchestratorState.Stopped;
      this.pendingStop = false;
    } else {
      this.state = OrchestratorState.Idle;
    }

    // Capture state before scheduleNext() — run() synchronously transitions to
    // Busy before its first await, so this.state would be "busy" by the time
    // emitLifecycle fires if we called scheduleNext() first.
    const endState = this.state as Exclude<OrchestratorState, "busy">;

    // Notify SSE clients the session ended (after state transition so they see the new state)
    this.emitLifecycle({
      type: "session_end",
      state: endState,
    });

    // Schedule next work after notifying SSE clients — run() sets state to Busy
    // synchronously, which would corrupt the session_end event state.
    if (this.state === OrchestratorState.Idle) {
      this.scheduleNext();
    }
  }

  /**
   * Recover orphaned sessions — running sessions whose PID is no longer alive,
   * or re-adopt live sessions that were orphaned by a hot reload.
   *
   * Dead PIDs: mark session failed, reopen issue.
   * Live PIDs (no activeSession): re-adopt the first one found so the
   * orchestrator regains lifecycle control (exit handling, retro, review).
   */
  private async recoverOrphanedSessions(): Promise<void> {
    const convex = getConvexClient();
    const sessions = await convex.query(api.sessions.list, {
      projectId: this.projectId,
      status: SessionStatus.Running,
    });

    for (const session of sessions) {
      const pid = session.pid;
      const alive = pid ? isProcessAlive(pid) : false;

      if (!alive) {
        await convex.mutation(api.sessions.update, {
          sessionId: session._id,
          status: SessionStatus.Failed,
          endedAt: Date.now(),
          exitCode: -1,
        });
        // FLUX-25: Only reopen if the issue isn't already closed.
        // A session can be orphaned after it completed work but before its
        // status was updated to "completed" — reopening a closed issue
        // would undo finished work.
        const issue = await convex.query(api.issues.get, {
          issueId: session.issueId,
        });
        if (issue && issue.status !== IssueStatus.Closed) {
          await convex.mutation(api.issues.update, {
            issueId: session.issueId,
            status: IssueStatus.Open,
          });
        }
        continue;
      }

      // Live PID with no in-memory handle — re-adopt it.
      // Only re-adopt one; others will be picked up on the next cycle.
      if (this.activeSession === null) {
        if (!pid) {
          console.error(
            `[Orchestrator] Cannot re-adopt session ${session._id}: PID is null despite being alive`,
          );
          continue;
        }
        const adopted = await this.adoptOrphanedSession(session, pid);
        if (adopted) break;
      }
    }
  }

  /**
   * Re-adopt a live orphaned session after a hot reload.
   * Creates a lightweight ActiveSession (no stdout stream) and polls PID
   * liveness until the process exits, then runs the normal exit handler path.
   */
  private async adoptOrphanedSession(
    session: {
      _id: Id<"sessions">;
      issueId: Id<"issues">;
      type: string;
      phase?: string;
      agentSessionId?: string;
      startHead?: string;
      startedAt: number;
    },
    pid: number,
  ): Promise<boolean> {
    const convex = getConvexClient();

    // Fetch the issue for WorkPromptContext
    const issue = await convex.query(api.issues.get, {
      issueId: session.issueId,
    });
    if (!issue) {
      console.error(
        `[Orchestrator] Cannot re-adopt session ${session._id}: issue ${session.issueId} not found`,
      );
      return false;
    }

    // Determine phase from the persisted record. Falls back to type-based
    // inference for sessions created before the phase field existed.
    let phase: SessionPhaseValue;
    if (
      session.phase === SessionPhase.Work ||
      session.phase === SessionPhase.Retro ||
      session.phase === SessionPhase.Review
    ) {
      phase = session.phase;
    } else {
      // Legacy fallback: infer from session type
      phase =
        session.type === SessionType.Review
          ? SessionPhase.Review
          : SessionPhase.Work;
    }

    console.log(
      `[Orchestrator] Re-adopting orphaned session ${session._id} (PID ${pid}, phase: ${phase}) for ${issue.shortId}`,
    );

    // Lock orchestrator as busy
    this.state = OrchestratorState.Busy;

    // Create a lightweight ActiveSession — no real process handle or monitor,
    // just enough metadata for the exit handlers to function.
    const tmpPath = `/tmp/flux-session-${session._id}.log`;

    // Create a no-op monitor stub for the exit handler. The real monitor
    // was lost in the hot reload, but the tmp log file has the output.
    const stubMonitor = new SessionMonitor(session._id, this.projectId);

    // Build a no-op AgentProcess that only provides pid and a wait()
    // that resolves when we detect the PID has died.
    const { promise: exitPromise, resolve: resolveExit } =
      Promise.withResolvers<{ exitCode: number }>();

    const stubProcess: AgentProcess = {
      pid,
      stdout: new ReadableStream<Uint8Array>(),
      kill: () => {
        try {
          process.kill(pid); // SIGTERM (default)
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
      monitorDone: Promise.resolve(), // No stream to drain
      killed: false,
      timedOut: false,
      startHead: session.startHead ?? "",
      agentSessionId: session.agentSessionId ?? null,
      issue: {
        shortId: issue.shortId,
        title: issue.title,
        description: issue.description,
      },
      phase,
      timeoutTimer: null,
    };

    // Notify SSE clients of the re-adopted session so the UI reflects it
    // immediately. The stub monitor has no stdout to pipe, but clients need
    // the session_start event to know a session is active.
    this.emitLifecycle({
      type: "session_start",
      sessionId: session._id,
      issueId: session.issueId,
      pid,
      monitor: stubMonitor,
    });

    // Poll PID liveness and trigger exit handler when it dies
    this.pollPidAndHandleExit(pid, tmpPath, stubMonitor, resolveExit);

    // Fire-and-forget: handle exit when the PID dies (mirrors executeRun pattern)
    stubProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );

    // Start timeout enforcement for re-adopted sessions.
    // Uses remaining time based on session.startedAt, not the full timeout,
    // since the process has already been running.
    this.startSessionTimeout(session.startedAt);

    return true;
  }

  /**
   * Poll a PID's liveness at 2s intervals. When the PID dies:
   * 1. Load output from the tmp log file into the monitor buffer
   * 2. Resolve the exit promise (which triggers handleExit via the wait() chain)
   */
  private pollPidAndHandleExit(
    pid: number,
    tmpPath: string,
    monitor: SessionMonitor,
    resolveExit: (value: { exitCode: number }) => void,
  ): void {
    const interval = setInterval(async () => {
      if (isProcessAlive(pid)) return; // Still running, keep polling

      clearInterval(interval);

      // PID died — load tmp log into the monitor buffer for disposition parsing
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
            `[Orchestrator] No tmp log file at ${tmpPath} for re-adopted session`,
          );
        }
      } catch (err) {
        console.error(
          `[Orchestrator] Failed to read tmp log for re-adopted session:`,
          err,
        );
      }

      // Resolve with exit code -1 (unknown — process was not our child)
      resolveExit({ exitCode: -1 });
    }, 2_000);
  }
}

// Survive hot reloads: globalThis persists across Bun HMR re-evaluations,
// preventing ghost orchestrator instances with dangling Convex subscriptions.
const _global = globalThis as unknown as { __fluxOrchestrator?: Orchestrator };

export function getOrchestrator(projectId: Id<"projects">): Orchestrator {
  if (!_global.__fluxOrchestrator) {
    _global.__fluxOrchestrator = new Orchestrator(projectId);
  }
  return _global.__fluxOrchestrator;
}

export { Orchestrator };
export type { OrchestratorActiveSession } from "@/shared/orchestrator";
export { OrchestratorState } from "@/shared/orchestrator";
