import type { ParsedLine } from "../lib/parseStreamLine";

/**
 * Render a text-kind ParsedLine as pre-wrapped content.
 *
 * Both callers (ActivityPage, SessionDetail) only pass `text`-kind items here;
 * tool calls are rendered via ToolCallCard directly.
 */
export function StreamContent({
  parsed,
}: {
  parsed: Extract<ParsedLine, { kind: "text" }>;
}) {
  return <div className="whitespace-pre-wrap break-words">{parsed.text}</div>;
}
