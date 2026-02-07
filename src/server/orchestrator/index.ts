import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { IssueStatus, SessionStatus, SessionType } from "$convex/schema";
import { getConvexClient } from "../convex";
import {
  autoCommitDirtyTree,
  getCommitLog,
  getCurrentHead,
  getDiff,
  hasNewCommits,
  resolveRepoRoot,
} from "../git";
import type { AgentProcess, AgentProvider, WorkPromptContext } from "./agents";
import {
  ClaudeCodeProvider,
  Disposition,
  parseDisposition,
  StatusMessages,
} from "./agents";
import { SessionMonitor } from "./monitor";

/**
 * Orchestrator states — runtime state of the Flux daemon.
 * STOPPED: scheduler disabled, no auto-scheduling.
 * IDLE: scheduler enabled, waiting for work.
 * BUSY: active session in progress.
 */
const OrchestratorState = {
  Stopped: "stopped",
  Idle: "idle",
  Busy: "busy",
} as const;
type OrchestratorState =
  (typeof OrchestratorState)[keyof typeof OrchestratorState];

/** The phase of the current issue lifecycle within a busy orchestrator. */
type SessionPhase = "work" | "retro" | "review";

/** Runtime info about the currently active session. */
interface ActiveSession {
  sessionId: Id<"sessions">;
  issueId: Id<"issues">;
  process: AgentProcess;
  monitor: SessionMonitor;
  monitorDone: Promise<void>;
  killed: boolean;
  /** Git HEAD when the work session started */
  startHead: string;
  /** Claude session UUID captured from stream-json output */
  agentSessionId: string | null;
  /** Issue context for prompt building */
  issue: WorkPromptContext;
  /** Current phase of the issue lifecycle */
  phase: SessionPhase;
}

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
  private maxReviewIterations = 5;

  constructor(projectId: Id<"projects">, provider?: AgentProvider) {
    this.projectId = projectId;
    this.provider = provider ?? new ClaudeCodeProvider();
  }

  getStatus(): {
    state: OrchestratorState;
    schedulerEnabled: boolean;
    readyCount: number;
    activeSession: {
      sessionId: string;
      issueId: string;
      pid: number;
      phase: SessionPhase;
    } | null;
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
      startHead,
      agentSessionId: null,
      issue: issueCtx,
      phase: "work",
    };

    // 9. Wire up agentSessionId extraction from stream-json
    const activeRef = this.activeSession;
    monitor.onLine((line) => {
      if (activeRef.agentSessionId) return; // Already captured
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === "system" && typeof obj.session_id === "string") {
          activeRef.agentSessionId = obj.session_id;
        }
      } catch {
        // Not JSON — ignore
      }
    });

    // 10. Fire-and-forget: handle agent exit in background
    agentProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );

    return { sessionId: session._id, pid: agentProcess.pid };
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

    // Wait for monitor to finish draining stdout before finalizing
    try {
      await this.activeSession.monitorDone;
    } catch (err) {
      console.error("[Orchestrator] Monitor drain error:", err);
    }
    await this.activeSession.monitor.shutdown();

    // Kill path: hand-off to human — session failed, issue stays in_progress
    if (this.activeSession.killed) {
      const convex = getConvexClient();
      await convex.mutation(api.sessions.update, {
        sessionId: this.activeSession.sessionId,
        status: SessionStatus.Failed,
        endedAt: Date.now(),
        exitCode,
      });
      this.finalize();
      return;
    }

    // Route to phase-specific handler.
    // CRITICAL: finalize() MUST run regardless of errors, otherwise the orchestrator
    // wedges in Busy state forever. Any throw in a phase handler that skips finalize()
    // means the scheduler stops picking up new work.
    try {
      const { phase } = this.activeSession;
      if (phase === "work") {
        await this.handleWorkExit(exitCode);
      } else if (phase === "retro") {
        await this.handleRetroExit(exitCode);
      } else if (phase === "review") {
        await this.handleReviewExit(exitCode);
      }
    } catch (err) {
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
  private async handleWorkExit(exitCode: number): Promise<void> {
    const active = this.activeSession!;
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
      return;
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
      return;
    }

    // ── Noop ──
    if (disposition === Disposition.Noop) {
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: "noop",
        closeReason: note,
      });
      this.finalize();
      return;
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
      return;
    }

    if (!hasCommits) {
      // Agent said done but made no commits — treat as noop
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: "noop",
        closeReason: note,
      });
      this.finalize();
      return;
    }

    // Done with commits — auto-commit dirty tree, then proceed to retro
    try {
      await autoCommitDirtyTree(cwd, issue.shortId, String(sessionId), "work");
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
          author: "flux",
        });
      } catch (err) {
        console.error(
          "[Orchestrator] Failed to create retro-skip comment:",
          err,
        );
      }
      await this.startReviewLoop();
    }
  }

  /**
   * Handle retro session exit. Retro is advisory — never blocks the pipeline.
   * Always proceeds to review regardless of retro outcome.
   */
  private async handleRetroExit(_exitCode: number): Promise<void> {
    const active = this.activeSession!;
    const { sessionId, issue } = active;
    const convex = getConvexClient();
    const cwd = await resolveRepoRoot();

    // Auto-commit any retro changes (e.g., friction fixes)
    try {
      await autoCommitDirtyTree(cwd, issue.shortId, String(sessionId), "retro");
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
    await this.startReviewLoop();
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
  private async handleReviewExit(exitCode: number): Promise<void> {
    const active = this.activeSession!;
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
      return;
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
      return;
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
        closeType: "completed",
        closeReason: note || "Review passed clean — no issues found.",
      });
      this.finalize();
      return;
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
      return;
    }

    if (!hasCommits) {
      // Review done, no inline fixes — findings became follow-up issues
      await convex.mutation(api.issues.close, {
        issueId,
        closeType: "completed",
        closeReason:
          note || "Review complete, findings captured as follow-up issues.",
      });
      this.finalize();
      return;
    }

    // Review made commits — auto-commit dirty tree
    try {
      await autoCommitDirtyTree(
        cwd,
        issue.shortId,
        String(sessionId),
        "review",
      );
    } catch (err) {
      console.error("[Orchestrator] Auto-commit after review failed:", err);
    }

    // Check iteration limit
    if (newIterations >= this.maxReviewIterations) {
      console.warn(
        `[Orchestrator] ${StatusMessages.reviewLoopExhausted(issue.shortId, newIterations, this.maxReviewIterations)}`,
      );
      await convex.mutation(api.issues.update, {
        issueId,
        status: IssueStatus.Stuck,
      });
      this.finalize();
      return;
    }

    // Loop: start another review
    await this.startReviewLoop();
  }

  // ── Retro & review lifecycle ─────────────────────────────────────────

  /**
   * Start the retro phase by resuming the agent session.
   * Retro is advisory — the agent reflects and may create follow-up issues.
   */
  private async startRetro(workNote: string): Promise<void> {
    const active = this.activeSession!;
    const cwd = await resolveRepoRoot();

    const retroPrompt = this.provider.buildRetroPrompt({
      shortId: active.issue.shortId,
      title: active.issue.title,
      workNote,
    });

    // Resume the same agent session for retro
    const retroProcess = this.provider.resume({
      cwd,
      prompt: retroPrompt,
      sessionId: active.agentSessionId!,
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
    active.phase = "retro";

    // Fire-and-forget: handle retro exit
    retroProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );
  }

  /**
   * Start a review loop iteration. Spawns a fresh stateless review session
   * with diff and related issues context.
   */
  private async startReviewLoop(): Promise<void> {
    const active = this.activeSession!;
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
          closeType: "completed",
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
    active.phase = "review";

    // Fire-and-forget: handle review exit
    reviewProcess.wait().then(
      ({ exitCode }) => this.handleExit(exitCode),
      () => this.handleExit(1),
    );
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
        } catch {}
      }
    };
    tryNext();
  }

  /**
   * Finalize the current issue lifecycle. Clears active session and transitions
   * state based on pendingStop and subscription status.
   */
  private finalize(): void {
    this.activeSession = null;

    if (this.pendingStop || !this.unsubscribeReady) {
      this.state = OrchestratorState.Stopped;
      this.pendingStop = false;
    } else {
      this.state = OrchestratorState.Idle;
      this.scheduleNext();
    }
  }

  /**
   * Recover orphaned sessions — running sessions whose PID is no longer alive.
   * Marks them as failed and reopens their issues for retry.
   */
  private async recoverOrphanedSessions(): Promise<void> {
    const convex = getConvexClient();
    const sessions = await convex.query(api.sessions.list, {
      projectId: this.projectId,
      status: SessionStatus.Running,
    });

    for (const session of sessions) {
      const pid = session.pid;
      let alive = false;

      if (pid) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }

      if (!alive) {
        await convex.mutation(api.sessions.update, {
          sessionId: session._id,
          status: SessionStatus.Failed,
          endedAt: Date.now(),
          exitCode: -1,
        });
        await convex.mutation(api.issues.update, {
          issueId: session.issueId,
          status: IssueStatus.Open,
        });
      }
    }
  }
}

// Module-level singleton — initialized once per server lifetime
let _orchestrator: Orchestrator | undefined;

export function getOrchestrator(projectId: Id<"projects">): Orchestrator {
  if (!_orchestrator) {
    _orchestrator = new Orchestrator(projectId);
  }
  return _orchestrator;
}

export { Orchestrator, OrchestratorState };
