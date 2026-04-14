import type { PaginationStatus } from "convex/react";
import { useMemo } from "react";
import type { TranscriptNode } from "../lib/groupTranscriptEvents";
import { formatTime } from "../lib/format";
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
        <summary className="cursor-pointer p-3 text-base-content/60">
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
      <summary className="cursor-pointer px-3 py-2 text-base-content/50">
        <span className="font-mono text-xs">{systemSummary(node.raw)}</span>
      </summary>
      <pre className="overflow-x-auto border-base-content/10 border-t p-3 font-mono text-base-content/60 text-xs">
        {JSON.stringify(node.raw, null, 2)}
      </pre>
    </details>
  );
}

function formatRateLimitReset(resetsAt: number | null): string {
  if (resetsAt === null) return "unknown";
  return formatTime(resetsAt * 1000);
}

function rateLimitSummary(
  node: Extract<TranscriptNode, { type: "rate_limit" }>,
): string {
  const parts: string[] = [];
  if (node.parsed.info.rateLimitType) parts.push(node.parsed.info.rateLimitType);
  if (node.parsed.info.status) parts.push(node.parsed.info.status);
  if (node.parsed.info.overageStatus) {
    parts.push(`overage ${node.parsed.info.overageStatus}`);
  }
  if (node.parsed.info.resetsAt !== null) {
    parts.push(`resets ${formatRateLimitReset(node.parsed.info.resetsAt)}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "Rate limit event";
}

function renderRateLimitValue(value: string | boolean | null): string {
  if (value === null) return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

function RateLimitNode({
  node,
}: {
  node: Extract<TranscriptNode, { type: "rate_limit" }>;
}) {
  const details: Array<[label: string, value: string]> = [
    ["Status", renderRateLimitValue(node.parsed.info.status)],
    ["Window", renderRateLimitValue(node.parsed.info.rateLimitType)],
    ["Resets", formatRateLimitReset(node.parsed.info.resetsAt)],
    ["Overage", renderRateLimitValue(node.parsed.info.overageStatus)],
    [
      "Overage reason",
      renderRateLimitValue(node.parsed.info.overageDisabledReason),
    ],
    [
      "Using overage",
      renderRateLimitValue(node.parsed.info.isUsingOverage),
    ],
    ["Session", renderRateLimitValue(node.parsed.sessionId)],
    ["Event UUID", renderRateLimitValue(node.parsed.uuid)],
  ];

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
      <div className="font-medium text-warning-content">Rate limit event</div>
      <div className="mt-1 text-base-content/60 text-xs">
        {rateLimitSummary(node)}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-base-content/50 text-xs uppercase tracking-wide">
              {label}
            </dt>
            <dd className="min-w-0 break-all font-mono text-[11px] text-base-content/80">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 rounded-md border border-base-content/10 bg-base-100/60">
        <summary className="cursor-pointer px-3 py-2 text-base-content/50 text-xs">
          Raw event JSON
        </summary>
        <pre className="overflow-x-auto border-base-content/10 border-t p-3 font-mono text-[11px] text-base-content/70">
          {JSON.stringify(node.parsed.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** Render an assistant text node — use markdown for rich formatting. */
function TextNode({
  node,
}: {
  node: Extract<TranscriptNode, { type: "text" }>;
}) {
  const text = node.parsed.text.trim();
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
  /** Keys of the most recent 3 tool_call nodes — rendered expanded for readability. */
  const recentToolCallKeys = useMemo(() => {
    const toolCallKeys: string[] = [];
    for (const node of nodes) {
      if (node.type === "tool_call") toolCallKeys.push(node.key);
    }
    return new Set(toolCallKeys.slice(-3));
  }, [nodes]);

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
                      <ToolCallCard
                        pair={node.pair}
                        expanded={recentToolCallKeys.has(node.key)}
                      />
                    </div>
                    <Timestamp ts={node.timestamp} />
                  </div>
                );
              case "rate_limit":
                return (
                  <div key={node.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <RateLimitNode node={node} />
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
