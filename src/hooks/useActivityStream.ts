import { useCallback, useEffect, useRef, useState } from "react";

/** Event types from the SSE endpoint */
export interface SessionStartEvent {
  type: "session_start";
  sessionId: string;
  issueId: string;
  pid: number;
}

export interface ActivityEvent {
  type: "activity";
  content: string;
}

export interface StatusEvent {
  type: "status";
  state: "stopped" | "idle" | "busy";
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
 * Hook that connects to /sse/activity and streams live agent output.
 * Handles reconnection on disconnect with exponential backoff.
 *
 * Events are buffered in a ref and flushed to React state on a
 * requestAnimationFrame cadence (~60fps), collapsing hundreds of
 * per-line SSE events into at most ~60 re-renders per second.
 */
export function useActivityStream(): ActivityStreamState & {
  clear: () => void;
  currentSession: SessionStartEvent | null;
} {
  const [events, setEvents] = useState<KeyedStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentSession, setCurrentSession] =
    useState<SessionStartEvent | null>(null);
  const retryDelay = useRef(1000);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Batching machinery ---
  // Incoming events accumulate here between animation frames.
  const bufferRef = useRef<KeyedStreamEvent[]>([]);
  // Whether we have a pending rAF flush scheduled.
  const flushScheduledRef = useRef(false);

  /** Schedule a flush on the next animation frame (if not already scheduled). */
  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(() => {
      flushScheduledRef.current = false;
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
    setEvents([]);
    setCurrentSession(null);
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      es = new EventSource("/sse/activity");

      es.addEventListener("open", () => {
        setConnected(true);
        retryDelay.current = 1000; // Reset backoff on successful connect
      });

      es.addEventListener("session_start", (e: MessageEvent) => {
        const data = parseSSE<{
          sessionId: string;
          issueId: string;
          pid: number;
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
        };
        setCurrentSession(sessionEvent);
        enqueue(sessionEvent);
      });

      es.addEventListener("activity", (e: MessageEvent) => {
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
      });

      es.addEventListener("status", (e: MessageEvent) => {
        const data = parseSSE<{
          state: "stopped" | "idle" | "busy";
          message: string;
        }>(e, "status", bufferRef.current);
        if (!data) {
          scheduleFlush();
          return;
        }
        // Clear the sticky session banner when no session is active
        if (data.state === "idle" || data.state === "stopped") {
          setCurrentSession(null);
        }
        enqueue({
          type: "status" as const,
          state: data.state,
          message: data.message,
        });
      });

      es.addEventListener("error", () => {
        setConnected(false);
        es?.close();
        es = null;
        // Reconnect with exponential backoff (max 30s)
        if (!disposed) {
          retryTimer.current = setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 2, 30_000);
            connect();
          }, retryDelay.current);
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      es?.close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [enqueue, scheduleFlush]);

  return { events, connected, clear, currentSession };
}
