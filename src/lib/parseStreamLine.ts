/**
 * Parse Claude `--output-format stream-json` NDJSON lines into
 * structured display data for the Activity page.
 *
 * Each line from stdout is a JSON envelope. We extract the meaningful
 * content and classify it so the UI can render it appropriately.
 */

export type ParsedLine =
  | { kind: "text"; text: string }
  | {
      kind: "tool_use";
      toolName: string;
      toolId: string;
      toolInput: Record<string, unknown> | null;
    }
  | { kind: "tool_result"; toolName: string | null; content: string }
  | { kind: "skip" };

/**
 * Summarize a tool's input arguments into a concise display string.
 * Returns null if there's nothing useful to show.
 */
export function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown> | null,
): string | null {
  if (!input || Object.keys(input).length === 0) return null;

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      return typeof input.file_path === "string"
        ? input.file_path.replace(/.*\//, "")
        : null;
    case "Bash":
      return typeof input.command === "string"
        ? truncate(input.command, 80)
        : null;
    case "Grep":
      return typeof input.pattern === "string"
        ? `/${truncate(input.pattern, 40)}/`
        : null;
    case "Glob":
      return typeof input.pattern === "string"
        ? truncate(input.pattern, 60)
        : null;
    case "WebFetch":
      return typeof input.url === "string" ? truncate(input.url, 80) : null;
    case "WebSearch":
      return typeof input.query === "string" ? truncate(input.query, 80) : null;
    case "Task":
      return typeof input.description === "string"
        ? truncate(input.description, 60)
        : null;
    case "TodoWrite":
      return null; // Too noisy, not useful
    default: {
      // Generic: show first string-valued key that looks meaningful
      const summary = genericInputSummary(input);
      return summary ? truncate(summary, 80) : null;
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** For unknown tools, pick the most informative string field to display. */
function genericInputSummary(input: Record<string, unknown>): string | null {
  // Prefer short descriptive keys
  const preferred = [
    "path",
    "file_path",
    "name",
    "query",
    "command",
    "url",
    "description",
    "content",
  ];
  for (const key of preferred) {
    if (typeof input[key] === "string" && input[key]) {
      return input[key] as string;
    }
  }
  // Fall back to first short string value
  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0 && val.length < 200) {
      return val;
    }
  }
  return null;
}

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
        toolInput: extractToolInput(block.input),
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
          toolInput: extractToolInput(tool.input),
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
      const toolResults = blocks.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0) {
        const parts: string[] = [];
        for (const toolResult of toolResults) {
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
          parts.push(content);
        }
        const joined = parts.filter(Boolean).join("\n---\n");
        // Truncate long tool results for the activity stream
        const maxLen = 500;
        const truncated =
          joined.length > maxLen
            ? `${joined.slice(0, maxLen)}… (${joined.length} chars)`
            : joined;
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

  // Unknown envelope type — surface it for debugging so we don't silently drop data
  if (typeof obj.type === "string") {
    return { kind: "text", text: `[${obj.type}]` };
  }

  // Not a recognized envelope — render as plain text
  return { kind: "text", text: line };
}

/** Safely extract tool input, returning null if not a valid object. */
function extractToolInput(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    return Object.keys(obj).length > 0 ? obj : null;
  }
  return null;
}
