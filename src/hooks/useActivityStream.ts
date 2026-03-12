import { useCallback, useEffect, useRef, useState } from "react";
import type { OrchestratorState } from "@/shared/orchestrator";
import { useSSE } from "./useSSE";

/** Event types from the SSE endpoint */
export interface SessionStartEvent {
  type: "session_start";
  sessionId: string;
  issueId: string;
  pid: number;
  agent: string;
}

export interface ActivityEvent {
  type: "activity";
  content: string;
}

export interface StatusEvent {
  type: "status";
  state: OrchestratorState;
  message: string;
}

export type StreamEvent = SessionStartEvent | ActivityEvent | StatusEvent;

/** StreamEvent with a unique monotonic id for stable React keys. */
export type KeyedStreamEvent = StreamEvent & { id: number };

export interface ActivityStreamState {
  events: KeyedStreamEvent[];
  connected: boolean;
}

let nextEventId = 0;

const MAX_EVENTS = 2000;

/** Parse SSE JSON payload, returning null (and surfacing the error) on failure. */
function parseSSE<T>(
  e: MessageEvent,
  eventName: string,
  buffer: KeyedStreamEvent[],
): T | null {
  try {
    return JSON.parse(e.data) as T;
  } catch {
    buffer.push({
      type: "activity",
      content: `[ERROR] Malformed ${eventName} payload: ${e.data}`,
      id: nextEventId++,
    });
    return null;
  }
}

/**
 * Hook that streams live agent output from the shared SSE connection.
 * Handles rAF batching to collapse hundreds of per-line SSE events
 * into at most ~60 re-renders per second.
 *
 * Requires an <SSEProvider> ancestor.
 */
export function useActivityStream(): ActivityStreamState & {
  clear: () => void;
  currentSession: SessionStartEvent | null;
} {
  const { connected, subscribe } = useSSE();
  const [events, setEvents] = useState<KeyedStreamEvent[]>([]);
  const [currentSession, setCurrentSession] =
    useState<SessionStartEvent | null>(null);

  // --- Batching machinery ---
  // Incoming events accumulate here between animation frames.
  const bufferRef = useRef<KeyedStreamEvent[]>([]);
  // rAF handle so we can cancel on unmount.
  const rafRef = useRef<number | null>(null);

  /** Schedule a flush on the next animation frame (if not already scheduled). */
  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pending = bufferRef.current;
      if (pending.length === 0) return;
      // Swap the buffer so new events accumulate in a fresh array
      // while we hand the batch to React.
      bufferRef.current = [];
      setEvents((prev) => {
        const merged = prev.concat(pending);
        return merged.length > MAX_EVENTS ? merged.slice(-MAX_EVENTS) : merged;
      });
    });
  }, []);

  /** Push an event into the buffer and schedule a flush. */
  const enqueue = useCallback(
    (event: StreamEvent) => {
      bufferRef.current.push({ ...event, id: nextEventId++ });
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const clear = useCallback(() => {
    bufferRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setEvents([]);
    setCurrentSession(null);
  }, []);

  // Subscribe to SSE events from the shared provider.
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      subscribe("session_start", (e: MessageEvent) => {
        const data = parseSSE<{
          sessionId: string;
          issueId: string;
          pid: number;
          agent: string;
        }>(e, "session_start", bufferRef.current);
        if (!data) {
          scheduleFlush();
          return;
        }
        const sessionEvent: SessionStartEvent = {
          type: "session_start" as const,
          sessionId: data.sessionId,
          issueId: data.issueId,
          pid: data.pid,
          agent: data.agent,
        };
        setCurrentSession(sessionEvent);
        enqueue(sessionEvent);
      }),
    );

    unsubs.push(
      subscribe("activity", (e: MessageEvent) => {
        const data = parseSSE<{ type: string; content: string }>(
          e,
          "activity",
          bufferRef.current,
        );
        if (!data) {
          scheduleFlush();
          return;
        }
        enqueue({
          type: "activity" as const,
          content: data.content,
        });
      }),
    );

    unsubs.push(
      subscribe("status", (e: MessageEvent) => {
        const data = parseSSE<{
          state: OrchestratorState;
          message: string;
        }>(e, "status", bufferRef.current);
        if (!data) {
          scheduleFlush();
          return;
        }
        // Clear the sticky session banner when no session is active
        if (data.state === "idle") {
          setCurrentSession(null);
        }
        enqueue({
          type: "status" as const,
          state: data.state,
          message: data.message,
        });
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [subscribe, enqueue, scheduleFlush]);

  return { events, connected, clear, currentSession };
}
