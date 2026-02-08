import { memo, useEffect, useMemo, useRef } from "react";
import { ToolCallCard, type ToolCallPair } from "../components/ToolCallCard";
import {
  type KeyedStreamEvent,
  useActivityStream,
} from "../hooks/useActivityStream";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import {
  isDisplayableParsedLine,
  type ParsedLine,
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
  item: Extract<ParsedLine, { kind: "tool_use" }>,
  toolInputMap: Map<string, Record<string, unknown>>,
): Extract<ParsedLine, { kind: "tool_use" }> {
  if (item.toolInput) return item;
  const accumulated = toolInputMap.get(item.toolId);
  if (!accumulated) return item;
  return { ...item, toolInput: accumulated };
}

// -- Display node types for the grouped activity feed -------------------------

type ActivityNode =
  | {
      type: "session_start";
      key: number;
      event: KeyedStreamEvent & { type: "session_start" };
    }
  | {
      type: "status";
      key: number;
      event: KeyedStreamEvent & { type: "status" };
    }
  | { type: "text"; key: string; parsed: Extract<ParsedLine, { kind: "text" }> }
  | { type: "tool_call"; key: string; pair: ToolCallPair };

/**
 * Group flat activity events into display nodes, merging tool_use + tool_result
 * pairs into single ToolCallPair entries.
 *
 * Streaming events arrive one at a time:
 *   content_block_start (tool_use) → input_json_deltas → assistant (tool_use with input)
 *   → user (tool_result)
 *
 * We accumulate pending tool_use items and pair them with subsequent tool_results
 * by toolUseId. Unmatched tool_use items are emitted as pending (no result).
 * De-duplication by toolId handles the content_block_start + assistant overlap.
 */
function groupActivityNodes(
  events: KeyedStreamEvent[],
  toolInputMap: Map<string, Record<string, unknown>>,
): ActivityNode[] {
  const nodes: ActivityNode[] = [];
  // Pending tool_use items awaiting their results, indexed by toolId for dedup
  const pendingToolUses = new Map<
    string,
    Extract<ParsedLine, { kind: "tool_use" }>
  >();
  // Insertion order for pending tool_uses (toolId), so we emit them in order
  const pendingOrder: string[] = [];

  for (const event of events) {
    if (event.type === "session_start") {
      // Flush pending before new session
      flushPending(nodes, pendingToolUses, pendingOrder);
      nodes.push({ type: "session_start", key: event.id, event });
      continue;
    }
    if (event.type === "status") {
      nodes.push({ type: "status", key: event.id, event });
      continue;
    }

    // Activity event — parse and group
    const items = parseStreamLine(event.content).filter(
      isDisplayableParsedLine,
    );

    for (const item of items) {
      if (item.kind === "tool_use") {
        const enriched = enrichToolUse(item, toolInputMap);
        const existing = pendingToolUses.get(enriched.toolId);
        if (!existing) {
          pendingToolUses.set(enriched.toolId, enriched);
          pendingOrder.push(enriched.toolId);
        } else if (!existing.toolInput && enriched.toolInput) {
          // Prefer the version with input (full assistant message over content_block_start)
          pendingToolUses.set(enriched.toolId, enriched);
        }
      } else if (item.kind === "tool_result") {
        // Try to match with a pending tool_use
        const matchId = item.toolUseId;
        const matched = matchId ? pendingToolUses.get(matchId) : null;
        if (matched) {
          nodes.push({
            type: "tool_call",
            key: `tool_call:${matched.toolId}`,
            pair: { toolUse: matched, toolResult: item },
          });
          pendingToolUses.delete(matched.toolId);
          const orderIdx = pendingOrder.indexOf(matched.toolId);
          if (orderIdx !== -1) pendingOrder.splice(orderIdx, 1);
        } else {
          // Orphaned result — synthesize a tool_use for it
          nodes.push({
            type: "tool_call",
            key: `orphan_result:${item.toolUseId ?? nodes.length}`,
            pair: {
              toolUse: {
                kind: "tool_use",
                toolName: item.toolName ?? "unknown",
                toolId: item.toolUseId ?? "",
                toolInput: null,
                blockIndex: null,
              },
              toolResult: item,
            },
          });
        }
      } else if (item.kind === "text") {
        nodes.push({
          type: "text",
          key: `text:${event.id}:${nodes.length}`,
          parsed: item,
        });
      }
    }
  }

  // Flush remaining pending tool_uses (still in-flight or session ended)
  flushPending(nodes, pendingToolUses, pendingOrder);

  return nodes;
}

/** Emit pending tool_use items as tool_call nodes without results. */
function flushPending(
  nodes: ActivityNode[],
  pending: Map<string, Extract<ParsedLine, { kind: "tool_use" }>>,
  order: string[],
) {
  for (const toolId of order) {
    const toolUse = pending.get(toolId);
    if (!toolUse) continue;
    nodes.push({
      type: "tool_call",
      key: `tool_call:${toolUse.toolId}`,
      pair: { toolUse, toolResult: null },
    });
  }
  pending.clear();
  order.length = 0;
}

// -- Rendering ----------------------------------------------------------------

/**
 * Custom comparator for memo(). `groupActivityNodes` returns fresh objects on
 * every call, so the default shallow comparison always re-renders. We compare
 * by stable key, and for tool_call nodes also check whether the result or
 * input has changed — the only fields that mutate for a given key.
 */
function activityNodeEqual(
  prev: { node: ActivityNode },
  next: { node: ActivityNode },
): boolean {
  if (prev.node.key !== next.node.key) return false;
  if (prev.node.type !== next.node.type) return false;
  if (prev.node.type === "tool_call" && next.node.type === "tool_call") {
    // Result can arrive after the initial tool_use
    if (prev.node.pair.toolResult !== next.node.pair.toolResult) return false;
    // Input can be enriched from content_block_start → full assistant message
    if (prev.node.pair.toolUse.toolInput !== next.node.pair.toolUse.toolInput)
      return false;
  }
  return true;
}

const ActivityNodeView = memo(function ActivityNodeView({
  node,
}: {
  node: ActivityNode;
}) {
  switch (node.type) {
    case "session_start":
      return (
        <div className="mb-1 border-base-content/20 border-b pb-1 text-info/60 text-xs">
          ── Session {node.event.sessionId.slice(0, 8)} │ Issue:{" "}
          {node.event.issueId} │ PID: {node.event.pid} ──
        </div>
      );
    case "status":
      return (
        <div className="text-warning italic">
          [{node.event.state}] {node.event.message}
        </div>
      );
    case "text":
      return (
        <div className="whitespace-pre-wrap break-words">
          {node.parsed.text}
        </div>
      );
    case "tool_call":
      return <ToolCallCard pair={node.pair} />;
    default: {
      const _exhaustive: never = node;
      throw new Error(
        `Unhandled node type: ${(_exhaustive as ActivityNode).type}`,
      );
    }
  }
}, activityNodeEqual);

export function ActivityPage() {
  useDocumentTitle("Activity");
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

  // Group events into display nodes with tool_use + tool_result pairing
  const displayNodes = useMemo(
    () => groupActivityNodes(events, toolInputMap),
    [events, toolInputMap],
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
          displayNodes.map((node) => (
            <ActivityNodeView key={node.key} node={node} />
          ))
        )}
      </div>
    </div>
  );
}
