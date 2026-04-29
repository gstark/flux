import type { AgentKindValue } from "$convex/schema";

/**
 * Parse provider stdout lines into structured display data for the Activity page.
 *
 * Claude emits structured NDJSON that we can parse richly.
 * Other providers currently fall back to raw text rendering until their
 * adapters emit a richer, provider-normalized transcript shape.
 */

export type ParsedLine =
  | { kind: "text"; text: string; source?: "delta" | "full" }
  | {
      kind: "tool_use";
      toolName: string;
      toolId: string;
      toolInput: Record<string, unknown> | null;
      /** Content block index from streaming, used for input_json_delta matching. */
      blockIndex: number | null;
    }
  | {
      kind: "tool_result";
      toolUseId: string | null;
      toolName: string | null;
      content: string;
    }
  | {
      /** Streaming tool input chunk — accumulate to enrich the matching tool_use. */
      kind: "tool_input_delta";
      blockIndex: number;
      jsonDelta: string;
    }
  | { kind: "system_init"; raw: Record<string, unknown> }
  | { kind: "skip" };

/** A tool_use paired with its optional tool_result. */
export type ToolCallPair = {
  toolUse: Extract<ParsedLine, { kind: "tool_use" }>;
  toolResult: Extract<ParsedLine, { kind: "tool_result" }> | null;
};

/**
 * Summarize a tool's input arguments into a concise display string.
 * Returns null if there's nothing useful to show.
 */
export function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown> | null,
): string | null {
  const canonicalToolName = canonicalizeToolName(toolName);
  if (!input || Object.keys(input).length === 0) return null;

  switch (canonicalToolName) {
    case "Read":
    case "Write":
    case "Edit":
      return typeof input.file_path === "string"
        ? input.file_path.replace(/.*\//, "")
        : null;
    case "Bash":
      return typeof input.command === "string"
        ? truncate(input.command, 1024)
        : null;
    case "Grep":
      return typeof input.pattern === "string"
        ? `/${truncate(input.pattern, 1024)}/`
        : null;
    case "Glob":
      return typeof input.pattern === "string"
        ? truncate(input.pattern, 1024)
        : null;
    case "WebFetch":
      return typeof input.url === "string" ? truncate(input.url, 1024) : null;
    case "WebSearch":
      return typeof input.query === "string"
        ? truncate(input.query, 1024)
        : null;
    case "Task":
      return typeof input.description === "string"
        ? truncate(input.description, 1024)
        : null;
    case "TodoWrite":
      return null; // Too noisy, not useful
    default: {
      // Generic: show first string-valued key that looks meaningful
      const summary = genericInputSummary(input);
      return summary ? truncate(summary, 1024) : null;
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function canonicalizeToolName(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "bash":
      return "Bash";
    case "read":
      return "Read";
    case "write":
      return "Write";
    case "edit":
      return "Edit";
    case "grep":
      return "Grep";
    case "glob":
      return "Glob";
    case "webfetch":
      return "WebFetch";
    case "websearch":
      return "WebSearch";
    case "task":
      return "Task";
    default:
      return toolName;
  }
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

export function parseStreamLine(
  line: string,
  agent: AgentKindValue | string = "claude",
): ParsedLine[] {
  if (agent === "codex") {
    return parseCodexStreamLine(line);
  }
  if (agent === "opencode") {
    return parseOpenCodeStreamLine(line);
  }
  if (agent === "pi") {
    return parsePiStreamLine(line);
  }
  if (agent !== "claude") {
    return parseGenericStreamLine(line);
  }
  return parseClaudeStreamLine(line);
}

/**
 * Parse a single NDJSON line from Claude's stream-json output.
 * Returns an array of structured representations for UI rendering.
 */
function parseClaudeStreamLine(line: string): ParsedLine[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Not JSON — treat as plain text (e.g. raw stderr or non-stream output)
    return line.trim() ? [{ kind: "text", text: line }] : [{ kind: "skip" }];
  }

  // ── content_block_delta ──────────────────────────────────────────
  if (obj.type === "content_block_delta") {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return [{ kind: "text", text: delta.text, source: "delta" }];
    }
    // input_json_delta = streaming tool input chunk — expose for accumulation
    if (
      delta?.type === "input_json_delta" &&
      typeof delta.partial_json === "string" &&
      typeof obj.index === "number"
    ) {
      return [
        {
          kind: "tool_input_delta",
          blockIndex: obj.index,
          jsonDelta: delta.partial_json,
        },
      ];
    }
    return [{ kind: "skip" }];
  }

  // ── content_block_start ──────────────────────────────────────────
  if (obj.type === "content_block_start") {
    const block = obj.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use") {
      return [
        {
          kind: "tool_use",
          toolName: (block.name as string) ?? "unknown",
          toolId: (block.id as string) ?? "",
          toolInput: extractToolInput(block.input),
          blockIndex: typeof obj.index === "number" ? obj.index : null,
        },
      ];
    }
    // text block start — no content yet, skip
    return [{ kind: "skip" }];
  }

  // ── content_block_stop ───────────────────────────────────────────
  if (obj.type === "content_block_stop") {
    return [{ kind: "skip" }];
  }

  // ── assistant: full message with content array ───────────────────
  if (obj.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (message && Array.isArray(message.content)) {
      const blocks = message.content as Array<Record<string, unknown>>;
      const results: ParsedLine[] = [];

      // Collect all text blocks into a single text entry
      const texts = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) {
        results.push({ kind: "text", text: texts.join(""), source: "full" });
      }

      // Collect ALL tool_use blocks — not just the first
      for (const block of blocks) {
        if (block.type === "tool_use") {
          results.push({
            kind: "tool_use",
            toolName: (block.name as string) ?? "unknown",
            toolId: (block.id as string) ?? "",
            toolInput: extractToolInput(block.input),
            blockIndex: null, // Full messages have complete input; no streaming index needed
          });
        }
      }

      if (results.length > 0) return results;
    }
    return [{ kind: "skip" }];
  }

  // ── result: final output ─────────────────────────────────────────
  // The result event repeats the final assistant text — tag as "full"
  // so the grouper can deduplicate against preceding delta/assistant text.
  if (obj.type === "result") {
    if (Array.isArray(obj.result)) {
      const texts = (obj.result as Array<Record<string, unknown>>)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string);
      if (texts.length > 0) {
        return [{ kind: "text", text: texts.join(""), source: "full" }];
      }
    }
    if (typeof obj.result === "string") {
      return [{ kind: "text", text: obj.result, source: "full" }];
    }
    // Result with only usage/stats — skip
    return [{ kind: "skip" }];
  }

  // ── user: tool results or nudge messages ────────────────────────
  if (obj.type === "user") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (message) {
      // Nudge: plain text content (not tool_result blocks)
      if (typeof message.content === "string") {
        return [{ kind: "text", text: message.content, source: "full" }];
      }
      if (Array.isArray(message.content)) {
        const blocks = message.content as Array<Record<string, unknown>>;
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        if (toolResults.length > 0) {
          const results: ParsedLine[] = [];
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
            // Truncate long tool results for the activity stream
            const maxLen = 500;
            const truncated =
              content.length > maxLen
                ? `${content.slice(0, maxLen)}… (${content.length} chars)`
                : content;
            results.push({
              kind: "tool_result",
              toolUseId:
                typeof toolResult.tool_use_id === "string"
                  ? toolResult.tool_use_id
                  : null,
              toolName: null,
              content: truncated,
            });
          }
          return results;
        }
      }
    }
    return [{ kind: "skip" }];
  }

  // ── system: init / config events ─────────────────────────────────
  if (obj.type === "system") {
    return [{ kind: "system_init", raw: obj }];
  }

  // ── message lifecycle events — no displayable content ────────────
  if (
    obj.type === "message_start" ||
    obj.type === "message_delta" ||
    obj.type === "message_stop"
  ) {
    return [{ kind: "skip" }];
  }

  // Unknown envelope type — surface it for debugging so we don't silently drop data
  if (typeof obj.type === "string") {
    return [{ kind: "text", text: `[${obj.type}]` }];
  }

  // Not a recognized envelope — render as plain text
  return [{ kind: "text", text: line }];
}

function parseGenericStreamLine(line: string): ParsedLine[] {
  if (!line.trim()) return [{ kind: "skip" }];
  return [{ kind: "text", text: line }];
}

function parseCodexStreamLine(line: string): ParsedLine[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line.trim() ? [{ kind: "text", text: line }] : [{ kind: "skip" }];
  }

  if (obj.type === "thread.started" || obj.type === "turn.started") {
    return [{ kind: "skip" }];
  }

  if (obj.type === "turn.completed") {
    return [{ kind: "skip" }];
  }

  if (obj.type === "item.started" || obj.type === "item.completed") {
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item || typeof item.type !== "string") {
      return [{ kind: "skip" }];
    }

    if (item.type === "agent_message" && typeof item.text === "string") {
      return [{ kind: "text", text: item.text, source: "full" }];
    }

    if (
      item.type === "command_execution" &&
      typeof item.id === "string" &&
      typeof item.command === "string"
    ) {
      if (obj.type === "item.started") {
        return [
          {
            kind: "tool_use",
            toolName: "Bash",
            toolId: item.id,
            toolInput: { command: item.command },
            blockIndex: null,
          },
        ];
      }

      const output =
        typeof item.aggregated_output === "string"
          ? item.aggregated_output
          : "";
      const exitCode =
        typeof item.exit_code === "number" ? `\n[exit ${item.exit_code}]` : "";
      return [
        {
          kind: "tool_result",
          toolUseId: item.id,
          toolName: "Bash",
          content: `${output}${exitCode}`.trim(),
        },
      ];
    }
  }

  return [{ kind: "skip" }];
}

function parseOpenCodeStreamLine(line: string): ParsedLine[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line.trim() ? [{ kind: "text", text: line }] : [{ kind: "skip" }];
  }

  if (obj.type === "step_start" || obj.type === "step_finish") {
    return [{ kind: "skip" }];
  }

  if (obj.type === "text") {
    const part = obj.part as Record<string, unknown> | undefined;
    if (part && typeof part.text === "string") {
      return [{ kind: "text", text: part.text, source: "full" }];
    }
    return [{ kind: "skip" }];
  }

  if (obj.type === "tool_use") {
    const part = obj.part as Record<string, unknown> | undefined;
    const state = part?.state as Record<string, unknown> | undefined;
    const input = state?.input as Record<string, unknown> | undefined;
    const metadata = state?.metadata as Record<string, unknown> | undefined;

    const callId =
      typeof part?.callID === "string"
        ? part.callID
        : typeof part?.id === "string"
          ? part.id
          : "";
    const toolName = canonicalizeToolName(
      typeof part?.tool === "string" ? String(part.tool) : "unknown",
    );
    const output =
      typeof metadata?.output === "string"
        ? metadata.output
        : typeof state?.output === "string"
          ? state.output
          : "";
    const exitSuffix =
      typeof metadata?.exit === "number" ? `\n[exit ${metadata.exit}]` : "";

    return [
      {
        kind: "tool_use",
        toolName,
        toolId: callId,
        toolInput:
          input && typeof input === "object" && !Array.isArray(input)
            ? input
            : null,
        blockIndex: null,
      },
      {
        kind: "tool_result",
        toolUseId: callId || null,
        toolName,
        content: `${output}${exitSuffix}`.trim(),
      },
    ];
  }

  return [{ kind: "skip" }];
}

function parsePiStreamLine(line: string): ParsedLine[] {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line.trim() ? [{ kind: "text", text: line }] : [{ kind: "skip" }];
  }

  if (
    obj.type === "response" ||
    obj.type === "agent_start" ||
    obj.type === "turn_start" ||
    obj.type === "extension_ui_request" ||
    obj.type === "tool_execution_update"
  ) {
    return [{ kind: "skip" }];
  }

  if (obj.type === "tool_execution_start") {
    const toolName = canonicalizeToolName(
      typeof obj.toolName === "string" ? obj.toolName : "unknown",
    );
    const toolId = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
    const toolInput = extractToolInput(obj.args);

    return [
      {
        kind: "tool_use",
        toolName,
        toolId,
        toolInput,
        blockIndex: null,
      },
    ];
  }

  if (obj.type === "message_update") {
    // Pi emits token/word-level thinking deltas before the turn-level summary.
    // If we surface them here, tool_result events flush pending output before
    // turn_end arrives, which leaves the transcript split into one-word rows.
    // Prefer the complete turn_end thinking block for readable transcripts.
    return [{ kind: "skip" }];
  }

  if (obj.type === "turn_end") {
    const message = obj.message as Record<string, unknown> | undefined;
    if (!message || !Array.isArray(message.content)) {
      return [{ kind: "skip" }];
    }

    const results: ParsedLine[] = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const part = block as Record<string, unknown>;

      if (part.type !== "thinking") continue;

      const text = extractPiThinkingText(part);
      if (text) {
        results.push({ kind: "text", text, source: "full" });
      }
    }

    return results.length > 0 ? results : [{ kind: "skip" }];
  }

  if (obj.type === "tool_execution_end") {
    const toolName = canonicalizeToolName(
      typeof obj.toolName === "string" ? obj.toolName : "unknown",
    );
    const toolUseId =
      typeof obj.toolCallId === "string" ? obj.toolCallId : null;
    const content = extractPiToolResultText(obj.result);

    return [
      {
        kind: "tool_result",
        toolUseId,
        toolName,
        content,
      },
    ];
  }

  if (obj.type === "message_start" || obj.type === "message_end") {
    return [{ kind: "skip" }];
  }

  return [{ kind: "skip" }];
}

/**
 * Extract concatenated text content from a single NDJSON line.
 *
 * Parses the line via `parseStreamLine` and joins all text-kind results.
 * Returns `null` if the line contains no text content (e.g. tool_use, skip).
 *
 * Used server-side for disposition parsing where only the text matters.
 */
export function extractTextFromLine(
  line: string,
  agent: AgentKindValue | string = "claude",
): string | null {
  const parsed =
    agent === "claude"
      ? parseClaudeStreamLine(line)
      : agent === "codex"
        ? parseCodexStreamLine(line)
        : agent === "opencode"
          ? parseOpenCodeStreamLine(line)
          : agent === "pi"
            ? parsePiStreamLine(line)
            : parseGenericStreamLine(line);
  const texts: string[] = [];
  for (const p of parsed) {
    if (p.kind === "text") texts.push(p.text);
  }
  return texts.length > 0 ? texts.join("") : null;
}

/** Whether a parsed line represents displayable content (not internal bookkeeping). */
export function isDisplayableParsedLine(p: ParsedLine): boolean {
  return p.kind !== "skip" && p.kind !== "tool_input_delta";
}

/** Safely extract tool input, returning null if not a valid object. */
function extractToolInput(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    return Object.keys(obj).length > 0 ? obj : null;
  }
  return null;
}

function extractPiToolResultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  if (!result || typeof result !== "object") {
    return "";
  }

  const obj = result as Record<string, unknown>;
  const content = obj.content;
  if (Array.isArray(content)) {
    const text = content
      .flatMap((part) => {
        if (!part || typeof part !== "object") return [] as string[];
        const entry = part as Record<string, unknown>;
        if (typeof entry.text === "string") return [entry.text];
        return [] as string[];
      })
      .join("");
    if (text) return text;
  }

  if (typeof obj.summary === "string") {
    return obj.summary;
  }

  if (typeof obj.message === "string") {
    return obj.message;
  }

  if (typeof obj.error === "string") {
    return obj.error;
  }

  return JSON.stringify(obj);
}

function extractPiThinkingText(block: Record<string, unknown>): string | null {
  if (typeof block.thinking === "string" && block.thinking.trim()) {
    return block.thinking;
  }

  const signature = block.thinkingSignature;
  if (!signature || typeof signature !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(signature) as Record<string, unknown>;
    const summary = parsed.summary;
    if (!Array.isArray(summary)) {
      return null;
    }

    const text = summary
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [] as string[];
        const item = entry as Record<string, unknown>;
        return typeof item.text === "string" ? [item.text] : [];
      })
      .join("\n");

    return text || null;
  } catch {
    return null;
  }
}
