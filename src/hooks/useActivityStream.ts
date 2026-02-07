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

function appendEvent(
  prev: KeyedStreamEvent[],
  event: StreamEvent,
): KeyedStreamEvent[] {
  const next = [...prev, { ...event, id: nextEventId++ }];
  return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
}

/** Parse SSE JSON payload, returning null (and surfacing the error) on failure. */
function parseSSE<T>(
  e: MessageEvent,
  eventName: string,
  setEvents: React.Dispatch<React.SetStateAction<KeyedStreamEvent[]>>,
): T | null {
  try {
    return JSON.parse(e.data) as T;
  } catch {
    setEvents((prev) =>
      appendEvent(prev, {
        type: "activity",
        content: `[ERROR] Malformed ${eventName} payload: ${e.data}`,
      }),
    );
    return null;
  }
}

/**
 * Hook that connects to /sse/activity and streams live agent output.
 * Handles reconnection on disconnect with exponential backoff.
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

  const clear = useCallback(() => {
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
        }>(e, "session_start", setEvents);
        if (!data) return;
        const sessionEvent: SessionStartEvent = {
          type: "session_start" as const,
          sessionId: data.sessionId,
          issueId: data.issueId,
          pid: data.pid,
        };
        setCurrentSession(sessionEvent);
        setEvents((prev) => appendEvent(prev, sessionEvent));
      });

      es.addEventListener("activity", (e: MessageEvent) => {
        const data = parseSSE<{ type: string; content: string }>(
          e,
          "activity",
          setEvents,
        );
        if (!data) return;
        setEvents((prev) =>
          appendEvent(prev, {
            type: "activity" as const,
            content: data.content,
          }),
        );
      });

      es.addEventListener("status", (e: MessageEvent) => {
        const data = parseSSE<{
          state: "stopped" | "idle" | "busy";
          message: string;
        }>(e, "status", setEvents);
        if (!data) return;
        // Clear the sticky session banner when no session is active
        if (data.state === "idle" || data.state === "stopped") {
          setCurrentSession(null);
        }
        setEvents((prev) =>
          appendEvent(prev, {
            type: "status" as const,
            state: data.state,
            message: data.message,
          }),
        );
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
  }, []);

  return { events, connected, clear, currentSession };
}
