import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useCallback, useMemo } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { DispositionValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { typeLabel } from "../lib/format";
import {
  groupTranscriptEvents,
  isDisplayableEvent,
} from "../lib/groupTranscriptEvents";
import { DispositionCallout } from "./DispositionCallout";
import { FontAwesomeIcon, faArrowLeft } from "./Icon";
import { SessionMetadata } from "./SessionMetadata";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { SessionTranscript } from "./SessionTranscript";

export function SessionDetail({ sessionId }: { sessionId: Id<"sessions"> }) {
  const session = useQuery(api.sessions.getWithIssue, { sessionId });
  const {
    results: events,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.sessionEvents.listPaginated,
    { sessionId },
    { initialNumItems: 200 },
  );

  const displayableEvents = useMemo(
    () =>
      events.filter((event) =>
        isDisplayableEvent(event.direction, event.content),
      ),
    [events],
  );

  const transcriptNodes = useMemo(
    () => groupTranscriptEvents(displayableEvents),
    [displayableEvents],
  );

  const handleLoadMore = useCallback(() => loadMore(200), [loadMore]);

  useDocumentTitle(
    session
      ? session.issueShortId
        ? `${session.issueShortId} ${typeLabel(session.type)} Session`
        : `${typeLabel(session.type)} Session`
      : undefined,
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
        <DispositionCallout
          disposition={session.disposition as DispositionValue}
          note={session.note}
        />
      )}

      {/* Metadata */}
      <SessionMetadata
        type={session.type}
        phase={session.phase}
        status={session.status}
        agent={session.agent}
        issueId={session.issueId}
        issueShortId={session.issueShortId}
        issueTitle={session.issueTitle}
        startedAt={session.startedAt}
        endedAt={session.endedAt}
        exitCode={session.exitCode}
        model={session.model}
        turns={session.turns}
        tokens={session.tokens}
        cost={session.cost}
        toolCalls={session.toolCalls}
        startHead={session.startHead}
        endHead={session.endHead}
      />

      {/* Transcript */}
      <SessionTranscript
        nodes={transcriptNodes}
        eventCount={displayableEvents.length}
        paginationStatus={paginationStatus}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
