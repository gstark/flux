import type { PaginationStatus } from "convex/react";
import type { TranscriptNode } from "../lib/groupTranscriptEvents";
import { Markdown } from "./Markdown";
import { ToolCallCard } from "./ToolCallCard";

/** Collapse threshold — input nodes longer than this many lines get auto-collapsed. */
const COLLAPSE_LINE_THRESHOLD = 20;

interface SessionTranscriptProps {
  nodes: TranscriptNode[];
  eventCount: number;
  paginationStatus: PaginationStatus;
  onLoadMore: () => void;
}

/** Extract a short summary from an input node's content (first non-empty line, truncated). */
function inputSummary(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return "System prompt";
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/** Render an input node — auto-collapse long inputs behind a disclosure. */
function InputNode({
  node,
}: {
  node: Extract<TranscriptNode, { type: "input" }>;
}) {
  const lineCount = node.content.split("\n").length;
  const isLong = lineCount > COLLAPSE_LINE_THRESHOLD;

  if (isLong) {
    return (
      <details className="group rounded-lg border border-primary/20 bg-primary/5 text-sm">
        <summary className="cursor-pointer select-none p-3 text-base-content/60">
          <span className="font-medium">{inputSummary(node.content)}</span>
          <span className="ml-2 text-base-content/40 text-xs">
            ({lineCount} lines — click to expand)
          </span>
        </summary>
        <div className="whitespace-pre-wrap break-words border-primary/10 border-t p-3">
          <Markdown content={node.content} />
        </div>
      </details>
    );
  }

  return (
    <div className="whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
      <Markdown content={node.content} />
    </div>
  );
}

/** Render an assistant text node — use markdown for rich formatting. */
function TextNode({
  node,
}: {
  node: Extract<TranscriptNode, { type: "text" }>;
}) {
  const text = node.parsed.text;
  const isShort = text.split("\n").length <= 2 && text.length < 120;

  if (isShort) {
    return (
      <div className="rounded-lg bg-base-200 px-3 py-2 text-base-content/80 text-sm">
        <Markdown content={text} />
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-base-200 p-3 text-sm">
      <Markdown content={text} />
    </div>
  );
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
                return <InputNode key={node.key} node={node} />;
              case "text":
                return <TextNode key={node.key} node={node} />;
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
