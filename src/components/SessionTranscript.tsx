import type { PaginationStatus } from "convex/react";
import type { TranscriptNode } from "../lib/groupTranscriptEvents";
import { Markdown } from "./Markdown";
import { Timestamp } from "./Timestamp";
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

/** Summarize a system init event for the disclosure summary line. */
function systemSummary(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof raw.model === "string") parts.push(raw.model);
  if (typeof raw.claude_code_version === "string")
    parts.push(`v${raw.claude_code_version}`);
  if (typeof raw.permissionMode === "string") parts.push(raw.permissionMode);
  if (Array.isArray(raw.mcp_servers)) {
    const connected = (
      raw.mcp_servers as Array<Record<string, unknown>>
    ).filter((s) => s.status === "connected").length;
    parts.push(`${connected} MCP`);
  }
  return parts.length > 0 ? parts.join(" / ") : "System init";
}

/** Render a system init event — collapsed by default, pretty-printed JSON. */
function SystemNode({
  node,
}: {
  node: Extract<TranscriptNode, { type: "system" }>;
}) {
  return (
    <details className="rounded-lg border border-base-content/10 bg-base-200/50 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-base-content/50">
        <span className="font-mono text-xs">{systemSummary(node.raw)}</span>
      </summary>
      <pre className="overflow-x-auto border-base-content/10 border-t p-3 font-mono text-base-content/60 text-xs">
        {JSON.stringify(node.raw, null, 2)}
      </pre>
    </details>
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
                return (
                  <div key={node.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <InputNode node={node} />
                    </div>
                    <Timestamp ts={node.timestamp} />
                  </div>
                );
              case "text":
                return (
                  <div key={node.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <TextNode node={node} />
                    </div>
                    <Timestamp ts={node.timestamp} />
                  </div>
                );
              case "tool_call":
                return (
                  <div key={node.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <ToolCallCard pair={node.pair} />
                    </div>
                    <Timestamp ts={node.timestamp} />
                  </div>
                );
              case "system":
                return (
                  <div key={node.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SystemNode node={node} />
                    </div>
                    <Timestamp ts={node.timestamp} />
                  </div>
                );
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
