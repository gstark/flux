import { memo, useEffect, useMemo, useRef } from "react";
import { StreamContent } from "../components/StreamContent";
import {
  type KeyedStreamEvent,
  useActivityStream,
} from "../hooks/useActivityStream";
import {
  type ParsedLine,
  parsedLineKey,
  parseStreamLine,
} from "../lib/parseStreamLine";

/**
 * Accumulator state for streaming tool input.
 *
 * Streaming sends tool input in three phases:
 * 1. `content_block_start` → tool_use with empty input, gives blockIndex + toolId
 * 2. `content_block_delta` → input_json_delta chunks, keyed by blockIndex
 * 3. `assistant` → full message with complete input (arrives later)
 *
 * We incrementally process new events, track blockIndex→toolId from (1),
 * accumulate JSON strings from (2), and parse the result to produce
 * toolId→input entries. This lets tool_use lines from content_block_start
 * display enriched input summaries before the full assistant message arrives.
 */
interface ToolInputAccumulator {
  /** blockIndex → toolId (from content_block_start) */
  blockToTool: Map<number, string>;
  /** blockIndex → accumulated JSON string fragments */
  blockJsonChunks: Map<number, string[]>;
  /** Resolved toolId → parsed input (updated incrementally) */
  resolved: Map<string, Record<string, unknown>>;
  /** Number of events already processed (for incremental updates) */
  processed: number;
}

function createAccumulator(): ToolInputAccumulator {
  return {
    blockToTool: new Map(),
    blockJsonChunks: new Map(),
    resolved: new Map(),
    processed: 0,
  };
}

/** Process new events into the accumulator, returning the (mutated) resolved map. */
function updateAccumulator(
  acc: ToolInputAccumulator,
  events: KeyedStreamEvent[],
): Map<string, Record<string, unknown>> {
  // If events were truncated (MAX_EVENTS cap) or cleared, reset
  if (events.length < acc.processed) {
    acc.blockToTool.clear();
    acc.blockJsonChunks.clear();
    acc.resolved.clear();
    acc.processed = 0;
  }

  const dirtyBlocks = new Set<number>();

  for (let i = acc.processed; i < events.length; i++) {
    const event = events[i];
    if (!event) continue;

    // New session — clear accumulated state so block indexes don't collide
    if (event.type === "session_start") {
      acc.blockToTool.clear();
      acc.blockJsonChunks.clear();
      acc.resolved.clear();
      continue;
    }
    if (event.type !== "activity") continue;

    const items = parseStreamLine(event.content);
    for (const item of items) {
      if (item.kind === "tool_use" && item.blockIndex !== null) {
        acc.blockToTool.set(item.blockIndex, item.toolId);
        // Clear stale chunks — block indexes reset each turn, so a new
        // tool_use at the same index means a different tool call.
        acc.blockJsonChunks.delete(item.blockIndex);
        dirtyBlocks.add(item.blockIndex);
      } else if (item.kind === "tool_input_delta") {
        let chunks = acc.blockJsonChunks.get(item.blockIndex);
        if (!chunks) {
          chunks = [];
          acc.blockJsonChunks.set(item.blockIndex, chunks);
        }
        chunks.push(item.jsonDelta);
        dirtyBlocks.add(item.blockIndex);
      }
    }
  }
  acc.processed = events.length;

  // Re-resolve only dirty blocks
  for (const blockIndex of dirtyBlocks) {
    const toolId = acc.blockToTool.get(blockIndex);
    const chunks = acc.blockJsonChunks.get(blockIndex);
    if (!toolId || !chunks || chunks.length === 0) continue;
    const json = chunks.join("");
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (Object.keys(obj).length > 0) {
          acc.resolved.set(toolId, obj);
        }
      }
    } catch {
      // Incomplete JSON — not enough deltas yet, ignore
    }
  }

  return acc.resolved;
}

/** Enrich a tool_use ParsedLine with accumulated streaming input if its own input is empty. */
function enrichToolUse(
  item: ParsedLine,
  toolInputMap: Map<string, Record<string, unknown>>,
): ParsedLine {
  if (item.kind !== "tool_use" || item.toolInput) return item;
  const accumulated = toolInputMap.get(item.toolId);
  if (!accumulated) return item;
  return { ...item, toolInput: accumulated };
}

const EventLine = memo(function EventLine({
  event,
  toolInputMap,
}: {
  event: KeyedStreamEvent;
  toolInputMap: Map<string, Record<string, unknown>>;
}) {
  switch (event.type) {
    case "session_start":
      return (
        <div className="mb-1 border-base-content/20 border-b pb-1 text-info/60 text-xs">
          ── Session {event.sessionId.slice(0, 8)} │ Issue: {event.issueId} │
          PID: {event.pid} ──
        </div>
      );
    case "activity": {
      const items = parseStreamLine(event.content).filter(
        (p) => p.kind !== "skip" && p.kind !== "tool_input_delta",
      );
      if (items.length === 0) return null;
      return (
        <>
          {items.map((parsed, i) => (
            <StreamContent
              key={parsedLineKey(parsed, i)}
              parsed={enrichToolUse(parsed, toolInputMap)}
            />
          ))}
        </>
      );
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
});

export function ActivityPage() {
  const { events, connected, clear, currentSession } = useActivityStream();
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  // Incrementally accumulate streaming tool input from input_json_delta chunks.
  // The ref holds mutable accumulator state; useMemo triggers re-resolution
  // when events change, returning the (stable-identity) resolved map.
  const accRef = useRef<ToolInputAccumulator>(createAccumulator());
  const toolInputMap = useMemo(
    () => updateAccumulator(accRef.current, events),
    [events],
  );

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

      {/* Sticky session banner */}
      {currentSession && (
        <div className="rounded-t-lg bg-neutral px-4 py-2 font-mono text-info text-sm">
          ── Session {currentSession.sessionId.slice(0, 8)} │ Issue:{" "}
          {currentSession.issueId} │ PID: {currentSession.pid} ──
        </div>
      )}

      {/* Terminal-style output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 grow overflow-y-auto ${currentSession ? "rounded-b-lg" : "rounded-lg"} bg-neutral p-4 font-mono text-neutral-content text-sm leading-relaxed`}
      >
        {events.length === 0 ? (
          <div className="text-base-content/40 italic">
            {connected
              ? "Waiting for activity..."
              : "Connecting to activity stream..."}
          </div>
        ) : (
          events.map((event) => (
            <EventLine
              key={event.id}
              event={event}
              toolInputMap={toolInputMap}
            />
          ))
        )}
      </div>
    </div>
  );
}
