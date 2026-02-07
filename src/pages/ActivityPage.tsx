import { useEffect, useRef } from "react";
import {
  type KeyedStreamEvent,
  useActivityStream,
} from "../hooks/useActivityStream";

function EventLine({ event }: { event: KeyedStreamEvent }) {
  switch (event.type) {
    case "session_start":
      return (
        <div className="mb-1 border-base-content/20 border-b pb-1 font-bold text-info">
          ── Session {event.sessionId.slice(0, 8)} │ Issue: {event.issueId} │
          PID: {event.pid} ──
        </div>
      );
    case "activity":
      return (
        <div className="whitespace-pre-wrap break-all">{event.content}</div>
      );
    case "status":
      return (
        <div className="text-warning italic">
          [{event.state}] {event.message}
        </div>
      );
    default: {
      const _exhaustive: never = event;
      throw new Error(
        `Unhandled event type: ${(_exhaustive as KeyedStreamEvent).type}`,
      );
    }
  }
}

export function ActivityPage() {
  const { events, connected, clear } = useActivityStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  // Track whether user has scrolled away from the bottom
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll.current = atBottom;
  }

  // Auto-scroll to bottom when new events arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: events.length triggers scroll on new events
  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header bar */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-xl">Activity</h1>
          <span
            className={`badge badge-sm ${connected ? "badge-success" : "badge-error"}`}
          >
            {connected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-base-content/50 text-sm">
            {events.length} events
          </span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
          Clear
        </button>
      </div>

      {/* Terminal-style output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="grow overflow-y-auto rounded-lg bg-neutral p-4 font-mono text-neutral-content text-sm leading-relaxed"
      >
        {events.length === 0 ? (
          <div className="text-base-content/40 italic">
            {connected
              ? "Waiting for activity..."
              : "Connecting to activity stream..."}
          </div>
        ) : (
          events.map((event) => <EventLine key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}
