import { Link } from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import type {
  SessionPhaseValue,
  SessionStatusValue,
  SessionTypeValue,
} from "$convex/schema";
import { useProjectSlug } from "../hooks/useProjectId";
import {
  formatDuration,
  formatTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import { SessionStatusBadge } from "./SessionStatusBadge";

interface SessionMetadataProps {
  type: SessionTypeValue;
  phase?: SessionPhaseValue;
  status: SessionStatusValue;
  agent: string;
  issueId?: Id<"issues">;
  issueShortId: string | null;
  issueTitle?: string | null;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  model?: string;
  turns?: number;
  tokens?: number;
  cost?: number;
  toolCalls?: number;
  startHead?: string;
  endHead?: string;
}

export function SessionMetadata({
  type,
  phase,
  status,
  agent,
  issueId,
  issueShortId,
  issueTitle,
  startedAt,
  endedAt,
  exitCode,
  model,
  turns,
  tokens,
  cost,
  toolCalls,
  startHead,
  endHead,
}: SessionMetadataProps) {
  const projectSlug = useProjectSlug();
  return (
    <div className="rounded-lg bg-base-200 p-4">
      <h3 className="mb-3 font-medium text-base-content/60 text-sm">
        Metadata
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-base-content/60">Type</dt>
        <dd>{typeLabel(type)}</dd>

        {phase && (
          <>
            <dt className="text-base-content/60">Phase</dt>
            <dd>{phaseLabel(phase)}</dd>
          </>
        )}

        <dt className="text-base-content/60">Status</dt>
        <dd>
          <SessionStatusBadge status={status} />
        </dd>

        <dt className="text-base-content/60">Agent</dt>
        <dd>{agent}</dd>

        <dt className="text-base-content/60">Issue</dt>
        <dd>
          {issueShortId && issueId ? (
            <Link
              to="/p/$projectSlug/issues/$issueId"
              params={{ projectSlug, issueId }}
              className="link link-hover font-mono"
            >
              {issueShortId}
              {issueTitle && (
                <span className="ml-2 text-base-content/60">{issueTitle}</span>
              )}
            </Link>
          ) : (
            <span className="text-base-content/40">—</span>
          )}
        </dd>

        <dt className="text-base-content/60">Started</dt>
        <dd>{formatTime(startedAt)}</dd>

        {endedAt && (
          <>
            <dt className="text-base-content/60">Ended</dt>
            <dd>{formatTime(endedAt)}</dd>
          </>
        )}

        <dt className="text-base-content/60">Duration</dt>
        <dd>{formatDuration(startedAt, endedAt)}</dd>

        {exitCode !== undefined && (
          <>
            <dt className="text-base-content/60">Exit Code</dt>
            <dd className="font-mono">
              <span className={exitCode === 0 ? "text-success" : "text-error"}>
                {exitCode}
              </span>
            </dd>
          </>
        )}

        {model && (
          <>
            <dt className="text-base-content/60">Model</dt>
            <dd className="font-mono text-xs">{model}</dd>
          </>
        )}

        {turns !== undefined && (
          <>
            <dt className="text-base-content/60">Turns</dt>
            <dd>{turns}</dd>
          </>
        )}

        {tokens !== undefined && (
          <>
            <dt className="text-base-content/60">Tokens</dt>
            <dd>{tokens.toLocaleString()}</dd>
          </>
        )}

        {cost !== undefined && (
          <>
            <dt className="text-base-content/60">Cost</dt>
            <dd>${cost.toFixed(4)}</dd>
          </>
        )}

        {toolCalls !== undefined && (
          <>
            <dt className="text-base-content/60">Tool Calls</dt>
            <dd>{toolCalls}</dd>
          </>
        )}

        {startHead && (
          <>
            <dt className="text-base-content/60">Start Head</dt>
            <dd className="font-mono text-xs">{startHead}</dd>
          </>
        )}

        {endHead && (
          <>
            <dt className="text-base-content/60">End Head</dt>
            <dd className="font-mono text-xs">{endHead}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
