import { SessionEventDirection } from "$convex/schema";
import type { ToolCallPair } from "../components/ToolCallCard";
import {
  isDisplayableParsedLine,
  type ParsedLine,
  parseStreamLine,
} from "./parseStreamLine";

// -- Transcript grouping types ------------------------------------------------

/**
 * A node in the grouped transcript.
 * - "input": user message rendered as markdown
 * - "text": assistant text content
 * - "tool_call": a tool_use header + collapsible result body
 */
export type TranscriptNode =
  | { type: "input"; key: string; content: string }
  | { type: "text"; key: string; parsed: Extract<ParsedLine, { kind: "text" }> }
  | { type: "tool_call"; key: string; pair: ToolCallPair };

// -- Grouping logic -----------------------------------------------------------

/**
 * Walk the flat list of session events and group consecutive
 * tool_use → tool_result pairs into single TranscriptNode entries.
 *
 * Algorithm: parse each event, collect pending tool_use items from output
 * events. When the next input event arrives with tool_result items, match
 * them by toolUseId (falling back to positional matching). Non-tool items
 * (text, input messages) emit immediately.
 */
export function groupTranscriptEvents(
  events: Array<{
    _id: string;
    direction: string;
    content: string;
    sequence: number;
  }>,
): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  // Pending tool_use items awaiting their results
  let pendingToolUses: Array<Extract<ParsedLine, { kind: "tool_use" }>> = [];

  for (const event of events) {
    if (event.direction === SessionEventDirection.Input) {
      const items = parseStreamLine(event.content).filter(
        isDisplayableParsedLine,
      );

      // Check if this input event has tool_result items that match pending tool_uses
      const toolResults = items.filter(
        (p): p is Extract<ParsedLine, { kind: "tool_result" }> =>
          p.kind === "tool_result",
      );

      if (toolResults.length > 0 && pendingToolUses.length > 0) {
        // Match tool_results to pending tool_uses
        const resultById = new Map<
          string,
          Extract<ParsedLine, { kind: "tool_result" }>
        >();
        const unmatchedResults: Array<
          Extract<ParsedLine, { kind: "tool_result" }>
        > = [];

        for (const result of toolResults) {
          if (result.toolUseId) {
            resultById.set(result.toolUseId, result);
          } else {
            unmatchedResults.push(result);
          }
        }

        // Pair each pending tool_use with its result
        const consumedIds = new Set<string>();
        let unmatchedIdx = 0;
        for (const toolUse of pendingToolUses) {
          const byId = resultById.get(toolUse.toolId);
          const matched = byId ?? unmatchedResults[unmatchedIdx++] ?? null;
          if (byId) consumedIds.add(toolUse.toolId);
          nodes.push({
            type: "tool_call",
            key: `tool_call:${toolUse.toolId}`,
            pair: { toolUse, toolResult: matched },
          });
        }

        // Show any leftover results that didn't match a pending tool_use
        for (const [id, result] of resultById) {
          if (!consumedIds.has(id)) {
            nodes.push({
              type: "tool_call",
              key: `orphan_result:${id}`,
              pair: {
                toolUse: {
                  kind: "tool_use",
                  toolName: result.toolName ?? "unknown",
                  toolId: id,
                  toolInput: null,
                  blockIndex: null,
                },
                toolResult: result,
              },
            });
          }
        }
        for (let i = unmatchedIdx; i < unmatchedResults.length; i++) {
          const result = unmatchedResults[i];
          if (!result) continue;
          nodes.push({
            type: "tool_call",
            key: `orphan_result:${event._id}:${nodes.length}`,
            pair: {
              toolUse: {
                kind: "tool_use",
                toolName: result.toolName ?? "unknown",
                toolId: result.toolUseId ?? "",
                toolInput: null,
                blockIndex: null,
              },
              toolResult: result,
            },
          });
        }
        pendingToolUses = [];
      } else {
        // Flush any unmatched pending tool_uses before the input
        flushPending(nodes, pendingToolUses);
        pendingToolUses = [];

        // Non-tool input event — render as markdown (skip tool_result-only inputs that had no pending)
        if (toolResults.length > 0) {
          // Orphaned tool_results with no preceding tool_use — show them inline
          for (const result of toolResults) {
            nodes.push({
              type: "tool_call",
              key: `orphan_result:${event._id}:${result.toolUseId ?? nodes.length}`,
              pair: {
                toolUse: {
                  kind: "tool_use",
                  toolName: result.toolName ?? "unknown",
                  toolId: result.toolUseId ?? "",
                  toolInput: null,
                  blockIndex: null,
                },
                toolResult: result,
              },
            });
          }
        } else {
          nodes.push({
            type: "input",
            key: `input:${event._id}`,
            content: event.content,
          });
        }
      }
    } else {
      // Output event — accumulate tool_use items across consecutive output
      // events (streaming produces content_block_start + assistant in sequence).
      // Do NOT flush pending tool_uses here; they'll be matched when the next
      // input event arrives with tool_results, or flushed at end-of-stream.
      const items = parseStreamLine(event.content).filter(
        isDisplayableParsedLine,
      );

      // De-duplicate tool_use items by toolId — streaming events
      // (content_block_start) and the full assistant message both emit the
      // same tool_use. Prefer the one with toolInput (the full assistant
      // message) over the empty one from content_block_start.
      for (const item of items) {
        if (item.kind === "tool_use") {
          const existingIdx = pendingToolUses.findIndex(
            (t) => t.toolId === item.toolId,
          );
          if (existingIdx === -1) {
            pendingToolUses.push(item);
          } else {
            const existing = pendingToolUses[existingIdx];
            if (existing && !existing.toolInput && item.toolInput) {
              pendingToolUses[existingIdx] = item;
            }
          }
        } else if (item.kind === "text") {
          nodes.push({
            type: "text",
            key: `text:${event._id}:${nodes.length}`,
            parsed: item,
          });
        }
      }
    }
  }

  // Flush any remaining pending tool_uses at the end (session may still be running)
  flushPending(nodes, pendingToolUses);

  return nodes;
}

/** Emit pending tool_use items as tool_call nodes without results. */
function flushPending(
  nodes: TranscriptNode[],
  pending: Array<Extract<ParsedLine, { kind: "tool_use" }>>,
) {
  for (const toolUse of pending) {
    nodes.push({
      type: "tool_call",
      key: `tool_call:${toolUse.toolId}`,
      pair: { toolUse, toolResult: null },
    });
  }
}

/** Check if an output event should be displayed (non-skip after parsing). */
export function isDisplayableEvent(
  direction: string,
  content: string,
): boolean {
  if (direction === SessionEventDirection.Input) return true;
  return parseStreamLine(content).some(isDisplayableParsedLine);
}
