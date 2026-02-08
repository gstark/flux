import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import {
  Disposition,
  SessionEventDirection,
  SessionStatus,
} from "$convex/schema";
import {
  formatDuration,
  formatTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import {
  type ParsedLine,
  parseStreamLine,
  summarizeToolInput,
} from "../lib/parseStreamLine";
import {
  FontAwesomeIcon,
  faArrowLeft,
  faCircleCheck,
  faScrewdriverWrench,
  Icon,
} from "./Icon";
import { Markdown } from "./Markdown";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { StreamContent } from "./StreamContent";

// -- Transcript grouping types ------------------------------------------------

/** A tool_use paired with its optional tool_result. */
type ToolCallPair = {
  toolUse: Extract<ParsedLine, { kind: "tool_use" }>;
  toolResult: Extract<ParsedLine, { kind: "tool_result" }> | null;
};

/**
 * A node in the grouped transcript.
 * - "input": user message rendered as markdown
 * - "text": assistant text content
 * - "tool_call": a tool_use header + collapsible result body
 */
type TranscriptNode =
  | { type: "input"; key: string; content: string }
  | { type: "text"; key: string; parsed: Extract<ParsedLine, { kind: "text" }> }
  | { type: "tool_call"; key: string; pair: ToolCallPair };

// -- Grouping logic -----------------------------------------------------------

/**
 * Walk the flat list of session events and group consecutive
 * tool_use → tool_result pairs into single TranscriptNode entries.
 *
 * Algorithm: parse each event, collect pending tool_use items from output
 * events. When the next input event arrives with tool_result items, match
 * them by toolUseId (falling back to positional matching). Non-tool items
 * (text, input messages) emit immediately.
 */
function groupTranscriptEvents(
  events: Array<{
    _id: string;
    direction: string;
    content: string;
    sequence: number;
  }>,
): TranscriptNode[] {
  const nodes: TranscriptNode[] = [];
  // Pending tool_use items awaiting their results
  let pendingToolUses: Array<Extract<ParsedLine, { kind: "tool_use" }>> = [];

  for (const event of events) {
    if (event.direction === SessionEventDirection.Input) {
      const items = parseStreamLine(event.content).filter(
        (p) => p.kind !== "skip",
      );

      // Check if this input event has tool_result items that match pending tool_uses
      const toolResults = items.filter(
        (p): p is Extract<ParsedLine, { kind: "tool_result" }> =>
          p.kind === "tool_result",
      );

      if (toolResults.length > 0 && pendingToolUses.length > 0) {
        // Match tool_results to pending tool_uses
        const resultById = new Map<
          string,
          Extract<ParsedLine, { kind: "tool_result" }>
        >();
        const unmatchedResults: Array<
          Extract<ParsedLine, { kind: "tool_result" }>
        > = [];

        for (const result of toolResults) {
          if (result.toolUseId) {
            resultById.set(result.toolUseId, result);
          } else {
            unmatchedResults.push(result);
          }
        }

        // Pair each pending tool_use with its result
        let unmatchedIdx = 0;
        for (const toolUse of pendingToolUses) {
          const matched =
            resultById.get(toolUse.toolId) ??
            unmatchedResults[unmatchedIdx++] ??
            null;
          nodes.push({
            type: "tool_call",
            key: `tool_call:${toolUse.toolId}`,
            pair: { toolUse, toolResult: matched },
          });
        }
        pendingToolUses = [];
      } else {
        // Flush any unmatched pending tool_uses before the input
        flushPending(nodes, pendingToolUses);
        pendingToolUses = [];

        // Non-tool input event — render as markdown (skip tool_result-only inputs that had no pending)
        if (toolResults.length > 0) {
          // Orphaned tool_results with no preceding tool_use — show them inline
          for (const result of toolResults) {
            nodes.push({
              type: "tool_call",
              key: `orphan_result:${event._id}:${result.toolUseId ?? nodes.length}`,
              pair: {
                toolUse: {
                  kind: "tool_use",
                  toolName: result.toolName ?? "unknown",
                  toolId: result.toolUseId ?? "",
                  toolInput: null,
                },
                toolResult: result,
              },
            });
          }
        } else {
          nodes.push({
            type: "input",
            key: `input:${event._id}`,
            content: event.content,
          });
        }
      }
    } else {
      // Output event
      const items = parseStreamLine(event.content).filter(
        (p) => p.kind !== "skip",
      );

      // Flush any pending tool_uses from a previous output before processing this one
      flushPending(nodes, pendingToolUses);
      pendingToolUses = [];

      for (const item of items) {
        if (item.kind === "tool_use") {
          pendingToolUses.push(item);
        } else if (item.kind === "text") {
          nodes.push({
            type: "text",
            key: `text:${event._id}:${nodes.length}`,
            parsed: item,
          });
        }
      }
    }
  }

  // Flush any remaining pending tool_uses at the end (session may still be running)
  flushPending(nodes, pendingToolUses);

  return nodes;
}

/** Emit pending tool_use items as tool_call nodes without results. */
function flushPending(
  nodes: TranscriptNode[],
  pending: Array<Extract<ParsedLine, { kind: "tool_use" }>>,
) {
  for (const toolUse of pending) {
    nodes.push({
      type: "tool_call",
      key: `tool_call:${toolUse.toolId}`,
      pair: { toolUse, toolResult: null },
    });
  }
}

// -- ToolCallCard component ---------------------------------------------------

/** A single collapsible card showing tool name + input summary, with result body. */
function ToolCallCard({ pair }: { pair: ToolCallPair }) {
  const { toolUse, toolResult } = pair;
  const summary = summarizeToolInput(toolUse.toolName, toolUse.toolInput);

  return (
    <details className="group rounded-lg bg-neutral font-mono text-neutral-content text-sm">
      <summary className="flex cursor-pointer select-none items-center gap-2 p-3">
        <FontAwesomeIcon
          icon={faScrewdriverWrench}
          aria-hidden="true"
          className="shrink-0 text-info"
        />
        <span className="font-semibold text-info">{toolUse.toolName}</span>
        {summary && (
          <span className="truncate text-base-content/50 text-xs">
            {summary}
          </span>
        )}
        {toolResult && (
          <FontAwesomeIcon
            icon={faCircleCheck}
            aria-hidden="true"
            className="ml-auto shrink-0 text-success"
          />
        )}
      </summary>
      {toolResult && (
        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words border-neutral-content/10 border-t px-3 pt-2 pb-3 text-xs">
          {toolResult.content}
        </div>
      )}
    </details>
  );
}

// -- Existing helpers ---------------------------------------------------------

type DispositionValue = (typeof Disposition)[keyof typeof Disposition];

function dispositionLabel(disposition: DispositionValue): {
  label: string;
  className: string;
  icon: string;
} {
  switch (disposition) {
    case Disposition.Done:
      return {
        label: "Done",
        className: "badge-success",
        icon: "fa-circle-check",
      };
    case Disposition.Noop:
      return {
        label: "No-op",
        className: "badge-info",
        icon: "fa-circle-minus",
      };
    case Disposition.Fault:
      return {
        label: "Fault",
        className: "badge-error",
        icon: "fa-circle-exclamation",
      };
    default: {
      const _exhaustive: never = disposition;
      throw new Error(`Unhandled disposition: ${_exhaustive}`);
    }
  }
}

/** Check if an output event should be displayed (non-skip after parsing). */
function isDisplayableEvent(direction: string, content: string): boolean {
  if (direction === SessionEventDirection.Input) return true;
  return parseStreamLine(content).some((p) => p.kind !== "skip");
}

export function SessionDetail({ sessionId }: { sessionId: Id<"sessions"> }) {
  const session = useQuery(api.sessions.getWithIssue, { sessionId });
  const events = useQuery(api.sessionEvents.list, { sessionId });

  const displayableEvents = useMemo(
    () =>
      events?.filter((event) =>
        isDisplayableEvent(event.direction, event.content),
      ) ?? [],
    [events],
  );

  const transcriptNodes = useMemo(
    () => groupTranscriptEvents(displayableEvents),
    [displayableEvents],
  );

  if (session === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-base-content/60">Session not found.</p>
        <Link to="/sessions" className="btn btn-sm">
          Back to Sessions
        </Link>
      </div>
    );
  }

  const isRunning = session.status === SessionStatus.Running;
  const dispo = session.disposition
    ? dispositionLabel(session.disposition as DispositionValue)
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link to="/sessions" className="btn btn-ghost btn-sm">
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
          Sessions
        </Link>
      </div>

      {/* Title row */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-xl">
          {typeLabel(session.type)} Session
        </h1>
        <SessionStatusBadge status={session.status} />
        {isRunning && <span className="loading loading-dots loading-xs" />}
      </div>

      {/* Disposition callout */}
      {session.disposition && (
        <div
          className={`flex flex-col gap-1 rounded-lg border p-4 ${
            session.disposition === Disposition.Fault
              ? "border-error/30 bg-error/10"
              : session.disposition === Disposition.Done
                ? "border-success/30 bg-success/10"
                : "border-info/30 bg-info/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Disposition:</span>
            <span className={`badge badge-sm gap-1 ${dispo?.className}`}>
              {dispo && <Icon name={dispo.icon} />}
              {dispo?.label}
            </span>
          </div>
          {session.note && (
            <p className="whitespace-pre-wrap text-sm">{session.note}</p>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="rounded-lg bg-base-200 p-4">
        <h3 className="mb-3 font-medium text-base-content/60 text-sm">
          Metadata
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-base-content/60">Type</dt>
          <dd>{typeLabel(session.type)}</dd>

          {session.phase && (
            <>
              <dt className="text-base-content/60">Phase</dt>
              <dd>{phaseLabel(session.phase)}</dd>
            </>
          )}

          <dt className="text-base-content/60">Status</dt>
          <dd>
            <SessionStatusBadge status={session.status} />
          </dd>

          <dt className="text-base-content/60">Agent</dt>
          <dd>{session.agent}</dd>

          <dt className="text-base-content/60">Issue</dt>
          <dd>
            {session.issueShortId ? (
              <Link
                to="/issues/$issueId"
                params={{ issueId: session.issueId }}
                className="link link-hover font-mono"
              >
                {session.issueShortId}
                {session.issueTitle && (
                  <span className="ml-2 text-base-content/60">
                    {session.issueTitle}
                  </span>
                )}
              </Link>
            ) : (
              <span className="text-base-content/40">—</span>
            )}
          </dd>

          <dt className="text-base-content/60">Started</dt>
          <dd>{formatTime(session.startedAt)}</dd>

          {session.endedAt && (
            <>
              <dt className="text-base-content/60">Ended</dt>
              <dd>{formatTime(session.endedAt)}</dd>
            </>
          )}

          <dt className="text-base-content/60">Duration</dt>
          <dd>{formatDuration(session.startedAt, session.endedAt)}</dd>

          {session.exitCode !== undefined && (
            <>
              <dt className="text-base-content/60">Exit Code</dt>
              <dd className="font-mono">
                <span
                  className={
                    session.exitCode === 0 ? "text-success" : "text-error"
                  }
                >
                  {session.exitCode}
                </span>
              </dd>
            </>
          )}

          {session.model && (
            <>
              <dt className="text-base-content/60">Model</dt>
              <dd className="font-mono text-xs">{session.model}</dd>
            </>
          )}

          {session.turns !== undefined && (
            <>
              <dt className="text-base-content/60">Turns</dt>
              <dd>{session.turns}</dd>
            </>
          )}

          {session.tokens !== undefined && (
            <>
              <dt className="text-base-content/60">Tokens</dt>
              <dd>{session.tokens.toLocaleString()}</dd>
            </>
          )}

          {session.cost !== undefined && (
            <>
              <dt className="text-base-content/60">Cost</dt>
              <dd>${session.cost.toFixed(4)}</dd>
            </>
          )}

          {session.toolCalls !== undefined && (
            <>
              <dt className="text-base-content/60">Tool Calls</dt>
              <dd>{session.toolCalls}</dd>
            </>
          )}

          {session.startHead && (
            <>
              <dt className="text-base-content/60">Start Head</dt>
              <dd className="font-mono text-xs">{session.startHead}</dd>
            </>
          )}

          {session.endHead && (
            <>
              <dt className="text-base-content/60">End Head</dt>
              <dd className="font-mono text-xs">{session.endHead}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Transcript */}
      <div>
        <h3 className="mb-3 font-medium text-base-content/60 text-sm">
          Transcript
          {events && (
            <span className="ml-2 text-base-content/40">
              ({displayableEvents.length}{" "}
              {displayableEvents.length === 1 ? "event" : "events"})
            </span>
          )}
        </h3>

        {events === undefined ? (
          <div className="flex justify-center p-8">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : transcriptNodes.length === 0 ? (
          <p className="py-8 text-center text-base-content/60">
            No transcript events recorded.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {transcriptNodes.map((node) => {
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
                      <StreamContent parsed={node.parsed} />
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
          </div>
        )}
      </div>
    </div>
  );
}
