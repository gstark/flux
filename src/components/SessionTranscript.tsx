import type { TranscriptNode } from "../lib/groupTranscriptEvents";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";

interface SessionTranscriptProps {
  nodes: TranscriptNode[];
  eventCount: number;
  paginationStatus:
    | "LoadingFirstPage"
    | "CanLoadMore"
    | "LoadingMore"
    | "Exhausted";
  onLoadMore: () => void;
}

export function SessionTranscript({
  nodes,
  eventCount,
  paginationStatus,
  onLoadMore,
}: SessionTranscriptProps) {
  return (
    <div>
      <h3 className="mb-3 font-medium text-base-content/60 text-sm">
        Transcript
        {eventCount > 0 && (
          <span className="ml-2 text-base-content/40">
            ({eventCount}
            {paginationStatus !== "Exhausted" ? "+" : ""}{" "}
            {eventCount === 1 ? "event" : "events"})
          </span>
        )}
      </h3>

      {paginationStatus === "LoadingFirstPage" ? (
        <div className="flex justify-center p-8">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : nodes.length === 0 ? (
        <p className="py-8 text-center text-base-content/60">
          No transcript events recorded.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {nodes.map((node) => {
            switch (node.type) {
              case "input":
                return (
                  <div
                    key={node.key}
                    className="whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                  >
                    <Markdown content={node.content} />
                  </div>
                );
              case "text":
                return (
                  <div
                    key={node.key}
                    className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-neutral p-3 font-mono text-neutral-content text-sm"
                  >
                    {node.parsed.text}
                  </div>
                );
              case "tool_call":
                return <ToolCallCard key={node.key} pair={node.pair} />;
              default: {
                const _exhaustive: never = node;
                throw new Error(
                  `Unhandled node type: ${(_exhaustive as TranscriptNode).type}`,
                );
              }
            }
          })}
          {paginationStatus === "CanLoadMore" && (
            <button
              type="button"
              className="btn btn-ghost btn-sm self-center"
              onClick={onLoadMore}
            >
              Load more events
            </button>
          )}
          {paginationStatus === "LoadingMore" && (
            <div className="flex justify-center p-4">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
