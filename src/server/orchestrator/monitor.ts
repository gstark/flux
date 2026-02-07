import fs from "node:fs/promises";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { SessionEventDirection } from "$convex/schema";
import { getConvexClient } from "../convex";
import { ActivityBuffer } from "./activity-buffer";

/** Pending event awaiting batch insert to Convex. */
interface PendingEvent {
  direction: "input" | "output";
  content: string;
  timestamp: number;
}

/**
 * SessionMonitor consumes agent stdout, maintains a rolling buffer,
 * writes to a tmp file for crash recovery, and batches events to Convex.
 */
export class SessionMonitor {
  readonly buffer: ActivityBuffer;
  private readonly sessionId: Id<"sessions">;
  private readonly tmpPath: string;
  private tmpWriter: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null =
    null;
  private lineListeners: Set<(line: string) => void> = new Set();
  private pendingEvents: PendingEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private convexFailures = 0;
  private _shuttingDown = false;
  private abortController: AbortController | null = null;
  private static readonly MAX_CONVEX_FAILURES = 5;
  private static readonly FLUSH_INTERVAL_MS = 5_000;
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;

  constructor(
    sessionId: Id<"sessions">,
    _projectId: Id<"projects">,
    initialSequence = 0,
  ) {
    this.sessionId = sessionId;
    this.buffer = new ActivityBuffer();
    this.tmpPath = `/tmp/flux-session-${sessionId}.log`;
    this.sequence = initialSequence;
  }

  /** Current event sequence counter. Used to continue numbering across retro monitors. */
  get currentSequence(): number {
    return this.sequence;
  }

  /**
   * Consume agent stdout stream. Resolves when the stream is fully drained.
   * MUST be awaited before handleExit() to prevent the stdout drain race.
   */
  async consume(stdout: ReadableStream<Uint8Array>): Promise<void> {
    // Open tmp file writer
    this.tmpWriter = Bun.file(this.tmpPath).writer();

    // Create abort controller so shutdown() can cancel the reader
    this.abortController = new AbortController();

    // Start periodic flush and heartbeat timers
    this.flushTimer = setInterval(async () => {
      try {
        await this.flushToConvex();
      } catch (err) {
        console.error(
          "[SessionMonitor] Fatal: Convex flush failed permanently, shutting down monitor:",
          err,
        );
        await this.shutdown();
      }
    }, SessionMonitor.FLUSH_INTERVAL_MS);
    this.heartbeatTimer = setInterval(
      () => this.updateHeartbeat(),
      SessionMonitor.HEARTBEAT_INTERVAL_MS,
    );

    const decoder = new TextDecoder();
    let partial = "";
    const reader = stdout.getReader();

    try {
      while (true) {
        // Check abort before each read so shutdown mid-consume exits promptly
        if (this.abortController.signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        partial += decoder.decode(value, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";

        for (const line of lines) {
          if (line.trim()) {
            this.processLine(line);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Handle final partial line (only if not aborted — data would be lost anyway)
    if (!this.abortController.signal.aborted) {
      const remaining = partial + decoder.decode();
      if (remaining.trim()) {
        this.processLine(remaining.trim());
      }
    }
  }

  /** Process a single line of stdout output. */
  private processLine(line: string): void {
    // After shutdown, drop lines — the abort controller should have broken the read loop,
    // but guard here as defense-in-depth for the race window between abort and loop exit.
    if (this._shuttingDown) return;

    // 1. Push to in-memory buffer
    this.buffer.push(line);

    // 2. Write to tmp file (NDJSON format)
    const logEntry = JSON.stringify({
      seq: this.sequence,
      dir: SessionEventDirection.Output,
      ts: Date.now(),
      content: line,
    });
    this.tmpWriter?.write(`${logEntry}\n`);

    // 3. Queue for Convex batch insert
    this.pendingEvents.push({
      direction: SessionEventDirection.Output,
      content: line,
      timestamp: Date.now(),
    });
    this.sequence++;

    // 4. Notify SSE listeners
    for (const listener of this.lineListeners) {
      try {
        listener(line);
      } catch {
        // Remove broken listeners silently
        this.lineListeners.delete(listener);
      }
    }
  }

  /** Register an SSE listener. Returns an unsubscribe function. */
  onLine(callback: (line: string) => void): () => void {
    this.lineListeners.add(callback);
    return () => this.lineListeners.delete(callback);
  }

  /**
   * Record an input event (e.g. the prompt sent to the agent).
   * Goes through the same batching pipeline as output events.
   */
  recordInput(content: string): void {
    if (this._shuttingDown) return;
    this.pendingEvents.push({
      direction: SessionEventDirection.Input,
      content,
      timestamp: Date.now(),
    });
    this.sequence++;
  }

  /** Flush pending events to Convex sessionEvents table. */
  private async flushToConvex(): Promise<void> {
    if (this.pendingEvents.length === 0) return;

    const batch = this.pendingEvents.splice(0);
    try {
      const convex = getConvexClient();
      await convex.mutation(api.sessionEvents.batchInsert, {
        sessionId: this.sessionId,
        events: batch,
      });
      this.convexFailures = 0; // Reset on success
    } catch (err) {
      this.convexFailures++;
      // Restore events before any potential throw so shutdown() can retry
      this.pendingEvents.unshift(...batch);
      console.error(
        `[SessionMonitor] Convex write failed (${this.convexFailures}/${SessionMonitor.MAX_CONVEX_FAILURES}):`,
        err,
      );
      if (this.convexFailures >= SessionMonitor.MAX_CONVEX_FAILURES) {
        throw new Error(
          `[SessionMonitor] Convex write failed ${SessionMonitor.MAX_CONVEX_FAILURES} times consecutively. Aborting monitor.`,
        );
      }
    }
  }

  /** Update lastHeartbeat in Convex. */
  private async updateHeartbeat(): Promise<void> {
    try {
      const convex = getConvexClient();
      await convex.mutation(api.sessions.update, {
        sessionId: this.sessionId,
        lastHeartbeat: Date.now(),
      });
    } catch (err) {
      console.error("[SessionMonitor] Heartbeat update failed:", err);
      // Non-fatal: heartbeat is informational
    }
  }

  /**
   * Shutdown the monitor: flush remaining events, close tmp file, clear timers.
   * Call this after consume() resolves and before finalizing the session.
   */
  async shutdown(): Promise<void> {
    if (this._shuttingDown) return;
    this._shuttingDown = true;

    // Abort the consume() reader loop if it's still active.
    // Don't null the controller — consume() reads the signal after breaking out of its loop.
    this.abortController?.abort();

    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Final flush — best effort; don't let a Convex failure prevent cleanup
    try {
      await this.flushToConvex();
    } catch (err) {
      console.error(
        "[SessionMonitor] Final flush failed during shutdown, events lost:",
        err,
      );
    }

    // Close tmp file writer
    if (this.tmpWriter) {
      this.tmpWriter.end();
      this.tmpWriter = null;
    }

    // Clear listeners
    this.lineListeners.clear();
  }

  /**
   * Delete the tmp log file. Call after shutdown() for successful sessions.
   * Skipped on failure paths so the file remains for debugging.
   */
  async cleanupTmpFile(): Promise<void> {
    try {
      await fs.unlink(this.tmpPath);
    } catch (err: unknown) {
      // ENOENT is fine — file already gone (e.g., manual cleanup or race)
      if (err instanceof Error && "code" in err && err.code !== "ENOENT") {
        throw err;
      }
    }
  }
}
