import { type ParsedLine, summarizeToolInput } from "../lib/parseStreamLine";
import { FontAwesomeIcon, faCircleCheck, faScrewdriverWrench } from "./Icon";

/**
 * Renderer for parsed stream-json lines.
 * Primary consumer is the Activity feed (real-time streaming).
 * SessionDetail uses this only for `text` kind nodes; tool calls
 * are rendered via ToolCallCard directly.
 */
export function StreamContent({ parsed }: { parsed: ParsedLine }) {
  switch (parsed.kind) {
    case "text":
      return (
        <div className="whitespace-pre-wrap break-words">{parsed.text}</div>
      );
    case "tool_use": {
      const summary = summarizeToolInput(parsed.toolName, parsed.toolInput);
      return (
        <div className="flex items-center gap-2 text-info">
          <FontAwesomeIcon
            icon={faScrewdriverWrench}
            aria-hidden="true"
            className="shrink-0"
          />
          <span className="font-semibold">{parsed.toolName}</span>
          {summary && (
            <span className="truncate font-normal text-base-content/50 text-xs">
              {summary}
            </span>
          )}
        </div>
      );
    }
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
    case "tool_input_delta":
    case "skip":
      return null;
  }
}
