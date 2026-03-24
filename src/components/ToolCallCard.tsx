import { summarizeToolInput, type ToolCallPair } from "../lib/parseStreamLine";
import {
  FontAwesomeIcon,
  faChevronRight,
  faCircleCheck,
  faScrewdriverWrench,
  faSpinner,
} from "./Icon";

/** A single collapsible card showing tool name + input summary, with result body. */
export function ToolCallCard({
  pair,
  expanded,
}: {
  pair: ToolCallPair;
  expanded?: boolean;
}) {
  const { toolUse, toolResult } = pair;
  const summary = summarizeToolInput(toolUse.toolName, toolUse.toolInput);

  const header = (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      {toolResult && (
        <FontAwesomeIcon
          icon={faChevronRight}
          aria-hidden="true"
          className="shrink-0 text-[10px] text-neutral-content/50 transition-transform duration-150 group-open:rotate-90"
        />
      )}
      <FontAwesomeIcon
        icon={faScrewdriverWrench}
        aria-hidden="true"
        className="shrink-0 text-info text-xs"
      />
      <span className="font-medium text-info text-sm">{toolUse.toolName}</span>
      {summary && (
        <span
          className="min-w-0 flex-1 truncate font-mono text-neutral-content/70 text-xs"
          title={summary}
        >
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
      <div className="rounded-lg border border-neutral-content/10 bg-neutral text-neutral-content text-sm">
        {header}
      </div>
    );
  }

  return (
    <details
      open={expanded}
      className="group rounded-lg border border-neutral-content/10 bg-neutral text-neutral-content text-sm"
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {header}
      </summary>
      <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-neutral-content/10 border-t px-3 pt-2 pb-3 font-mono text-xs">
        {summary}
      </div>
      <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-neutral-content/10 border-t px-3 pt-2 pb-3 font-mono text-xs">
        {toolResult.content}
      </div>
    </details>
  );
}
