import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Subscribable event types on the shared SSE connection.
 *
 * - "session_start" / "status" — SSE named events from the server
 * - "open" — fired on every (re)connect so consumers can refetch stale data
 */
type SSEEventType = "session_start" | "status" | "open";

type SSEListener = (event: MessageEvent) => void;

interface SSEContextValue {
  /** Whether the EventSource is currently connected. */
  connected: boolean;
  /** Subscribe to a named SSE event. Returns an unsubscribe function. */
  subscribe: (eventType: SSEEventType, listener: SSEListener) => () => void;
}

const SSEContext = createContext<SSEContextValue | null>(null);

/**
 * Provider that manages a single EventSource connection to /sse/projects/:projectId/activity.
 * Streams session_start and status events. All consumers share this connection.
 *
 * Reconnects automatically with exponential backoff (1s → 30s max).
 */
export function SSEProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [connected, setConnected] = useState(false);

  // Map of event type → Set of listeners. Mutable ref so we can
  // add/remove listeners without re-running the EventSource effect.
  const listenersRef = useRef(new Map<SSEEventType, Set<SSEListener>>());

  // Track connection state outside React so subscribe can read it
  // synchronously without depending on the `connected` state value.
  const connectedRef = useRef(false);

  // Stable subscribe function — never changes identity.
  // When subscribing to "open" on an already-connected provider,
  // the listener is invoked immediately so late subscribers don't
  // silently miss the initial connection event.
  const subscribeRef = useRef(
    (eventType: SSEEventType, listener: SSEListener) => {
      let set = listenersRef.current.get(eventType);
      if (!set) {
        set = new Set();
        listenersRef.current.set(eventType, set);
      }
      set.add(listener);

      // Fire immediately for late "open" subscribers so they can
      // do their initial fetch even if the connection is already up.
      if (eventType === "open" && connectedRef.current) {
        listener(new MessageEvent("open"));
      }

      const captured = set;
      return () => {
        captured.delete(listener);
      };
    },
  );

  useEffect(() => {
    let disposed = false;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let activeES: EventSource | null = null;

    /** Fan out to all registered listeners for a given event type. */
    function dispatch(type: SSEEventType, event: MessageEvent) {
      const set = listenersRef.current.get(type);
      if (!set) return;
      for (const fn of set) fn(event);
    }

    function connect() {
      if (disposed) return;
      const es = new EventSource(`/sse/projects/${projectId}/activity`);
      activeES = es;

      es.addEventListener("open", () => {
        connectedRef.current = true;
        setConnected(true);
        retryDelay = 1000;
        dispatch("open", new MessageEvent("open"));
      });

      // Wire server-sent event types to the listener map.
      const serverTypes: Array<"session_start" | "status"> = [
        "session_start",
        "status",
      ];
      for (const type of serverTypes) {
        es.addEventListener(type, (e: MessageEvent) => dispatch(type, e));
      }

      es.addEventListener("error", () => {
        connectedRef.current = false;
        setConnected(false);
        es.close();
        activeES = null;
        if (!disposed) {
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30_000);
            connect();
          }, retryDelay);
        }
      });
    }

    connect();

    return () => {
      disposed = true;
      connectedRef.current = false;
      setConnected(false);
      activeES?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [projectId]);

  const value = useMemo<SSEContextValue>(
    () => ({ connected, subscribe: subscribeRef.current }),
    [connected],
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}

/**
 * Access the shared SSE connection. Must be used within an SSEProvider.
 */
export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) {
    throw new Error("useSSE() must be used within an <SSEProvider>");
  }
  return ctx;
}
