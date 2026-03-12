import type { AgentKindValue } from "$convex/schema";
import { SessionEventDirection } from "$convex/schema";
import {
  isDisplayableParsedLine,
  type ParsedLine,
  parseStreamLine,
  type ToolCallPair,
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
 * Walk the flat list of session events and produce interleaved transcript nodes.
 *
 * Output items (text + tool_use) are accumulated in chronological order.
 * When a later event arrives with tool_results, the pending output is flushed
 * with tool_uses paired to their results — preserving the natural
 * think → act → result flow instead of batching all tool calls at the end.
 *
 * Text deduplication: streaming produces content_block_delta fragments AND a
 * full assistant message. Delta text is tagged source:"delta", full text is
 * tagged source:"full". When the full text arrives, preceding deltas are dropped.
 */

/**
 * A pending output item — either text or tool_use — preserving chronological
 * order so we can interleave think → act → result naturally.
 */
type PendingOutputItem =
  | {
      tag: "text";
      eventId: string;
      parsed: Extract<ParsedLine, { kind: "text" }>;
    }
  | { tag: "tool_use"; parsed: Extract<ParsedLine, { kind: "tool_use" }> };

export function groupTranscriptEvents(
  events: Array<{
    _id: string;
    direction: string;
    content: string;
    sequence: number;
  }>,
  agent: AgentKindValue | string = "claude",
): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  // Pending output items (text + tool_use) in chronological order
  let pendingOutput: PendingOutputItem[] = [];

  for (const event of events) {
    const items = parseStreamLine(event.content, agent).filter(
      isDisplayableParsedLine,
    );
    const toolResults = items.filter(
      (p): p is Extract<ParsedLine, { kind: "tool_result" }> =>
        p.kind === "tool_result",
    );

    if (toolResults.length > 0) {
      const pendingToolUses = pendingOutput.filter(
        (p): p is Extract<PendingOutputItem, { tag: "tool_use" }> =>
          p.tag === "tool_use",
      );

      if (pendingToolUses.length > 0) {
        // Match tool_results to pending tool_uses by id
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

        // Build a result lookup for pending tool_uses
        const pairedResults = new Map<
          string,
          Extract<ParsedLine, { kind: "tool_result" }> | null
        >();
        const consumedIds = new Set<string>();
        let unmatchedIdx = 0;
        for (const item of pendingToolUses) {
          const byId = resultById.get(item.parsed.toolId);
          const matched = byId ?? unmatchedResults[unmatchedIdx++] ?? null;
          if (byId) consumedIds.add(item.parsed.toolId);
          pairedResults.set(item.parsed.toolId, matched);
        }

        // Emit pending output items in chronological order — interleaved
        flushPendingInterleaved(nodes, pendingOutput, pairedResults);

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
      } else {
        // Flush any unmatched pending output before orphaned results.
        flushPendingInterleaved(nodes, pendingOutput, new Map());

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
      }

      pendingOutput = [];
      continue;
    }

    if (event.direction === SessionEventDirection.Input) {
      // Flush any unmatched pending output before the next human/system input.
      flushPendingInterleaved(nodes, pendingOutput, new Map());
      pendingOutput = [];

      nodes.push({
        type: "input",
        key: `input:${event._id}`,
        content: event.content,
      });
    } else {
      // Output event — accumulate text and tool_use items in chronological
      // order. They'll be emitted interleaved when results arrive or at end.
      for (const item of items) {
        if (item.kind === "tool_use") {
          // De-duplicate tool_use items by toolId — streaming events
          // (content_block_start) and the full assistant message both emit the
          // same tool_use. Prefer the one with toolInput (the full message).
          const existingIdx = pendingOutput.findIndex(
            (p) => p.tag === "tool_use" && p.parsed.toolId === item.toolId,
          );
          if (existingIdx === -1) {
            pendingOutput.push({ tag: "tool_use", parsed: item });
          } else {
            const existing = pendingOutput[existingIdx];
            if (
              existing &&
              existing.tag === "tool_use" &&
              !existing.parsed.toolInput &&
              item.toolInput
            ) {
              pendingOutput[existingIdx] = { tag: "tool_use", parsed: item };
            }
          }
        } else if (item.kind === "text") {
          // Deduplicate: full text supersedes preceding delta fragments.
          // Also skip if an identical full text already exists (assistant
          // event + result event both emit the same complete text).
          if (item.source === "full") {
            const duplicate = pendingOutput.some(
              (p) =>
                p.tag === "text" &&
                p.parsed.source === "full" &&
                p.parsed.text === item.text,
            );
            if (duplicate) continue;
            pendingOutput = pendingOutput.filter(
              (p) => !(p.tag === "text" && p.parsed.source === "delta"),
            );
          }
          pendingOutput.push({
            tag: "text",
            eventId: event._id,
            parsed: item,
          });
        }
      }
    }
  }

  // Flush any remaining pending output at the end (session may still be running)
  flushPendingInterleaved(nodes, pendingOutput, new Map());

  return nodes;
}

/**
 * Emit pending output items (text + tool_use) in chronological order.
 * Tool_use items are paired with their results from the map; text items
 * emit directly. This produces the natural think → act → result flow.
 */
function flushPendingInterleaved(
  nodes: TranscriptNode[],
  pending: PendingOutputItem[],
  results: Map<string, Extract<ParsedLine, { kind: "tool_result" }> | null>,
) {
  for (const item of pending) {
    if (item.tag === "text") {
      nodes.push({
        type: "text",
        key: `text:${item.eventId}:${nodes.length}`,
        parsed: item.parsed,
      });
    } else {
      const toolResult = results.get(item.parsed.toolId) ?? null;
      nodes.push({
        type: "tool_call",
        key: `tool_call:${item.parsed.toolId}`,
        pair: { toolUse: item.parsed, toolResult },
      });
    }
  }
}

/** Check if an output event should be displayed (non-skip after parsing). */
export function isDisplayableEvent(
  direction: string,
  content: string,
  agent: AgentKindValue | string = "claude",
): boolean {
  if (direction === SessionEventDirection.Input) return true;
  return parseStreamLine(content, agent).some(isDisplayableParsedLine);
}
