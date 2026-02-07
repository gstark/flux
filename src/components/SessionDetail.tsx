import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import {
  Disposition,
  SessionEventDirection,
  SessionStatus,
  SessionType,
} from "$convex/schema";
import { SessionStatusBadge } from "./SessionStatusBadge";

type DispositionValue = (typeof Disposition)[keyof typeof Disposition];
type SessionTypeValue = (typeof SessionType)[keyof typeof SessionType];

function typeLabel(type: SessionTypeValue): string {
  switch (type) {
    case SessionType.Work:
      return "Work";
    case SessionType.Review:
      return "Review";
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled session type: ${_exhaustive}`);
    }
  }
}

function dispositionLabel(disposition: DispositionValue): {
  label: string;
  className: string;
} {
  switch (disposition) {
    case Disposition.Done:
      return { label: "Done", className: "badge-success" };
    case Disposition.Noop:
      return { label: "No-op", className: "badge-info" };
    case Disposition.Fault:
      return { label: "Fault", className: "badge-error" };
    default: {
      const _exhaustive: never = disposition;
      throw new Error(`Unhandled disposition: ${_exhaustive}`);
    }
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatDuration(startedAt: number, endedAt?: number): string {
  if (!endedAt) return "—";
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function SessionDetail({ sessionId }: { sessionId: Id<"sessions"> }) {
  const session = useQuery(api.sessions.getWithIssue, { sessionId });
  const events = useQuery(api.sessionEvents.list, { sessionId });

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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link to="/sessions" className="btn btn-ghost btn-sm">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          Back
        </Link>
        <span className="font-mono text-base-content/60 text-sm">
          {session._id.slice(-8)}
        </span>
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
            <span
              className={`badge badge-sm ${dispositionLabel(session.disposition as DispositionValue).className}`}
            >
              {dispositionLabel(session.disposition as DispositionValue).label}
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
              ({events.length} {events.length === 1 ? "event" : "events"})
            </span>
          )}
        </h3>

        {events === undefined ? (
          <div className="flex justify-center p-8">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-base-content/60">
            No transcript events recorded.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((event) => (
              <div
                key={event._id}
                className={
                  event.direction === SessionEventDirection.Output
                    ? "overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-neutral p-3 font-mono text-neutral-content text-sm"
                    : "whitespace-pre-wrap break-words rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
                }
              >
                <div className="mb-1 flex items-center gap-2 text-xs opacity-60">
                  <span className="font-medium">
                    {event.direction === SessionEventDirection.Input
                      ? "Input"
                      : "Output"}
                  </span>
                  <span>#{event.sequence}</span>
                </div>
                {event.content}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
