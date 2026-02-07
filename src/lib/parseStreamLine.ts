/**
 * Parse Claude `--output-format stream-json` NDJSON lines into
 * structured display data for the Activity page.
 *
 * Each line from stdout is a JSON envelope. We extract the meaningful
 * content and classify it so the UI can render it appropriately.
 */

export type ParsedLine =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; toolName: string; toolId: string }
  | { kind: "tool_result"; toolName: string | null; content: string }
  | { kind: "skip" };

/**
 * Parse a single NDJSON line from Claude's stream-json output.
 * Returns a structured representation for UI rendering.
 *
 * Known envelope types:
 * - content_block_delta: streaming text or tool input chunks
 * - content_block_start: beginning of a content block (text or tool_use)
 * - content_block_stop: end of a content block (no useful data)
 * - assistant: full assistant message with content array
 * - result: final result with text blocks or usage stats
 * - message_start / message_delta / message_stop: message lifecycle events
 *
 * Lines that are not JSON or have no displayable content → "skip".
 */
export function parseStreamLine(line: string): ParsedLine {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not JSON — treat as plain text (e.g. raw stderr or non-stream output)
    return line.trim() ? { kind: "text", text: line } : { kind: "skip" };
  }

  // ── content_block_delta ──────────────────────────────────────────
  if (obj.type === "content_block_delta") {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return { kind: "text", text: delta.text };
    }
    // input_json_delta = streaming tool input — not useful to display
    return { kind: "skip" };
  }

  // ── content_block_start ──────────────────────────────────────────
  if (obj.type === "content_block_start") {
    const block = obj.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use") {
      return {
        kind: "tool_use",
        toolName: (block.name as string) ?? "unknown",
        toolId: (block.id as string) ?? "",
      };
    }
    // text block start — no content yet, skip
    return { kind: "skip" };
  }

  // ── content_block_stop ───────────────────────────────────────────
  if (obj.type === "content_block_stop") {
    return { kind: "skip" };
  }

  // ── assistant: full message with content array ───────────────────
  if (obj.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.content)) {
      const blocks = message.content as Array<Record<string, unknown>>;
      const texts = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) {
        return { kind: "text", text: texts.join("") };
      }
      // Only tool_use blocks, no text
      const tool = blocks.find((b) => b.type === "tool_use");
      if (tool) {
        return {
          kind: "tool_use",
          toolName: (tool.name as string) ?? "unknown",
          toolId: (tool.id as string) ?? "",
        };
      }
    }
    return { kind: "skip" };
  }

  // ── result: final output ─────────────────────────────────────────
  if (obj.type === "result") {
    if (Array.isArray(obj.result)) {
      const texts = (obj.result as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) {
        return { kind: "text", text: texts.join("") };
      }
    }
    if (typeof obj.result === "string") {
      return { kind: "text", text: obj.result };
    }
    // Result with only usage/stats — skip
    return { kind: "skip" };
  }

  // ── user: tool results ───────────────────────────────────────────
  if (obj.type === "user") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.content)) {
      const blocks = message.content as Array<Record<string, unknown>>;
      const toolResult = blocks.find((b) => b.type === "tool_result");
      if (toolResult) {
        let content = "";
        if (typeof toolResult.content === "string") {
          content = toolResult.content;
        } else if (Array.isArray(toolResult.content)) {
          const textParts = (
            toolResult.content as Array<Record<string, unknown>>
          )
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text as string);
          content = textParts.join("");
        }
        // Truncate long tool results for the activity stream
        const maxLen = 500;
        const truncated =
          content.length > maxLen
            ? `${content.slice(0, maxLen)}… (${content.length} chars)`
            : content;
        return {
          kind: "tool_result",
          toolName: null, // tool name is in the preceding tool_use
          content: truncated,
        };
      }
    }
    return { kind: "skip" };
  }

  // ── message lifecycle events — no displayable content ────────────
  if (
    obj.type === "message_start" ||
    obj.type === "message_delta" ||
    obj.type === "message_stop"
  ) {
    return { kind: "skip" };
  }

  // Unknown type — don't silently drop; show as text for debugging
  if (typeof obj.type === "string") {
    return { kind: "skip" };
  }

  // Not a recognized envelope — render as plain text
  return { kind: "text", text: line };
}
