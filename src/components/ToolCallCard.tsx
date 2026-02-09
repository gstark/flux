import { summarizeToolInput, type ToolCallPair } from "../lib/parseStreamLine";
import {
  FontAwesomeIcon,
  faCircleCheck,
  faScrewdriverWrench,
  faSpinner,
} from "./Icon";

/** A single collapsible card showing tool name + input summary, with result body. */
export function ToolCallCard({ pair }: { pair: ToolCallPair }) {
  const { toolUse, toolResult } = pair;
  const summary = summarizeToolInput(toolUse.toolName, toolUse.toolInput);

  const header = (
    <div className="flex items-center gap-2 px-3 py-2">
      <FontAwesomeIcon
        icon={faScrewdriverWrench}
        aria-hidden="true"
        className="shrink-0 text-info text-xs"
      />
      <span className="font-medium text-info text-sm">{toolUse.toolName}</span>
      {summary && (
        <span className="min-w-0 truncate font-mono text-neutral-content/70 text-xs">
          {summary}
        </span>
      )}
      {toolResult ? (
        <FontAwesomeIcon
          icon={faCircleCheck}
          aria-hidden="true"
          className="ml-auto shrink-0 text-success text-xs"
        />
      ) : (
        <FontAwesomeIcon
          icon={faSpinner}
          spin
          aria-hidden="true"
          className="ml-auto shrink-0 text-info/50 text-xs"
        />
      )}
    </div>
  );

  // No result yet — render as a static card (no misleading disclosure triangle)
  if (!toolResult) {
    return (
      <div className="rounded-lg bg-neutral text-neutral-content text-sm">
        {header}
      </div>
    );
  }

  return (
    <details className="group rounded-lg bg-neutral text-neutral-content text-sm">
      <summary className="cursor-pointer select-none">{header}</summary>
      <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-neutral-content/10 border-t px-3 pt-2 pb-3 font-mono text-xs">
        {toolResult.content}
      </div>
    </details>
  );
}
