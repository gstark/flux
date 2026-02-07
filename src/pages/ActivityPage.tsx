import { useEffect, useRef } from "react";
import {
  FontAwesomeIcon,
  faCircleCheck,
  faScrewdriverWrench,
} from "../components/Icon";
import {
  type KeyedStreamEvent,
  useActivityStream,
} from "../hooks/useActivityStream";
import { type ParsedLine, parseStreamLine } from "../lib/parseStreamLine";

/** Render a parsed stream-json line with appropriate formatting. */
function ActivityContent({ parsed }: { parsed: ParsedLine }) {
  switch (parsed.kind) {
    case "text":
      return (
        <div className="whitespace-pre-wrap break-words">{parsed.text}</div>
      );
    case "tool_use":
      return (
        <div className="flex items-center gap-2 text-info">
          <FontAwesomeIcon icon={faScrewdriverWrench} aria-hidden="true" />
          <span className="font-semibold">{parsed.toolName}</span>
        </div>
      );
    case "tool_result":
      return (
        <details className="group">
          <summary className="cursor-pointer select-none text-success">
            <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />{" "}
            <span className="text-base-content/60 text-xs">Tool result</span>
          </summary>
          <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-base-300/20 p-2 text-xs">
            {parsed.content}
          </div>
        </details>
      );
    case "skip":
      return null;
  }
}

function EventLine({ event }: { event: KeyedStreamEvent }) {
  switch (event.type) {
    case "session_start":
      return (
        <div className="mb-1 border-base-content/20 border-b pb-1 font-bold text-info">
          ── Session {event.sessionId.slice(0, 8)} │ Issue: {event.issueId} │
          PID: {event.pid} ──
        </div>
      );
    case "activity": {
      const parsed = parseStreamLine(event.content);
      if (parsed.kind === "skip") return null;
      return <ActivityContent parsed={parsed} />;
    }
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

  // Auto-scroll to bottom when new events arrive.
  // Use last event id (not events.length) so this fires even when the array
  // is capped at MAX_EVENTS and length stops changing.
  const lastEvent = events[events.length - 1];
  const lastEventId = lastEvent !== undefined ? lastEvent.id : -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastEventId is the stable trigger for new events
  useEffect(() => {
    const el = scrollRef.current;
    if (autoScroll.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastEventId]);

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
