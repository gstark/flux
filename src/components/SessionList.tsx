import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Fragment, useMemo, useState } from "react";
import { api } from "$convex/_generated/api";
import type { SessionPhaseValue, SessionStatusValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import {
  formatDuration,
  formatRelativeTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import { faChevronRight, FontAwesomeIcon } from "./Icon";
import { SessionStatusBadge } from "./SessionStatusBadge";
import { SortableHeader, useSortableTable, useSorted } from "./SortableHeader";

type StatusFilter = SessionStatusValue | null;

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Running", value: SessionStatus.Running },
  { label: "Completed", value: SessionStatus.Completed },
  { label: "Failed", value: SessionStatus.Failed },
];

const PAGE_SIZE = 50;

const SESSION_STATUS_ORDER: Record<string, number> = {
  [SessionStatus.Running]: 0,
  [SessionStatus.Completed]: 1,
  [SessionStatus.Failed]: 2,
};

function buildSessionSummary(session: {
  status: SessionStatusValue;
  phase?: SessionPhaseValue;
  note?: string | null;
  transitionSummary?: string | null;
}) {
  const parts: Array<{ label: string; content: string }> = [];

  if (session.transitionSummary) {
    parts.push({
      label: "Status summary",
      content: session.transitionSummary,
    });
  } else if (session.status === SessionStatus.Running) {
    parts.push({
      label: "Status summary",
      content: session.phase
        ? `Still running in ${phaseLabel(session.phase)}.`
        : "Still running.",
    });
  }

  if (session.note) {
    parts.push({
      label: "Agent note",
      content: session.note,
    });
  }

  return parts;
}

export function SessionList() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Record<string, boolean>>({});

  const {
    results: sessions,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.sessions.listPaginatedWithIssues,
    {
      projectId,
      status: statusFilter ?? undefined,
    },
    { initialNumItems: PAGE_SIZE },
  );

  const sessionCounts = useQuery(api.sessions.counts, { projectId });

  const totalAll =
    sessionCounts === undefined
      ? undefined
      : Object.values(sessionCounts).reduce((a, b) => a + b, 0);

  type SessionItem = (typeof sessions)[number];
  type SessionSortKey =
    | "type"
    | "phase"
    | "status"
    | "issue"
    | "agent"
    | "started"
    | "duration";

  const { sort, toggle } = useSortableTable<SessionSortKey>();
  const comparators = useMemo(
    () => ({
      type: (a: SessionItem, b: SessionItem) => a.type.localeCompare(b.type),
      phase: (a: SessionItem, b: SessionItem) =>
        (a.phase ?? "").localeCompare(b.phase ?? ""),
      status: (a: SessionItem, b: SessionItem) =>
        (SESSION_STATUS_ORDER[a.status] ?? 99) -
        (SESSION_STATUS_ORDER[b.status] ?? 99),
      issue: (a: SessionItem, b: SessionItem) =>
        (a.issueShortId ?? "").localeCompare(b.issueShortId ?? "", undefined, {
          numeric: true,
        }),
      agent: (a: SessionItem, b: SessionItem) => a.agent.localeCompare(b.agent),
      started: (a: SessionItem, b: SessionItem) => a.startedAt - b.startedAt,
      duration: (a: SessionItem, b: SessionItem) => {
        const durA = a.endedAt
          ? a.endedAt - a.startedAt
          : Number.MAX_SAFE_INTEGER;
        const durB = b.endedAt
          ? b.endedAt - b.startedAt
          : Number.MAX_SAFE_INTEGER;
        return durA - durB;
      },
    }),
    [],
  );
  const sortedSessions = useSorted(sessions, sort, comparators);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="font-bold text-xl">Sessions</h2>

      <div role="tablist" className="tabs tabs-box">
        {TABS.map((tab) => {
          const count =
            sessionCounts === undefined
              ? undefined
              : tab.value === null
                ? totalAll
                : (sessionCounts[tab.value] ?? 0);
          return (
            <button
              key={tab.label}
              role="tab"
              type="button"
              className={`tab ${statusFilter === tab.value ? "tab-active" : ""}`}
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
              {count !== undefined && (
                <span className="badge badge-sm ml-1.5">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {paginationStatus === "LoadingFirstPage" ? (
        <div className="flex justify-center p-8">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="py-8 text-center text-base-content/60">
          No sessions found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-zebra table">
            <thead>
              <tr>
                <th className="w-0" aria-label="Expand session details" />
                <SortableHeader
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Phase"
                  sortKey="phase"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Issue"
                  sortKey="issue"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Agent"
                  sortKey="agent"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Started"
                  sortKey="started"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Duration"
                  sortKey="duration"
                  sort={sort}
                  onToggle={toggle}
                />
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((session) => {
                const summaryParts = buildSessionSummary(session);
                const isExpanded = expandedSessionIds[session._id] ?? false;
                const hasSummary = summaryParts.length > 0;

                return (
                  <Fragment key={session._id}>
                    <tr className="hover:bg-base-200">
                      <td className="w-0 px-2 py-0 align-top">
                        {hasSummary ? (
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} session details`}
                            className="flex h-full min-h-12 items-center py-3 text-base-content/50 transition-colors hover:text-base-content"
                            onClick={() =>
                              setExpandedSessionIds((current) => ({
                                ...current,
                                [session._id]: !current[session._id],
                              }))
                            }
                          >
                            <FontAwesomeIcon
                              icon={faChevronRight}
                              aria-hidden="true"
                              className={`text-xs transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                            />
                          </button>
                        ) : (
                          <span className="block w-3" aria-hidden="true" />
                        )}
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3"
                        >
                          {typeLabel(session.type)}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3 text-sm"
                        >
                          {session.phase ? phaseLabel(session.phase) : "—"}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3"
                        >
                          <SessionStatusBadge status={session.status} />
                        </Link>
                      </td>
                      <td>
                        {session.issueShortId && session.issueId ? (
                          <Link
                            to="/p/$projectSlug/issues/$issueId"
                            params={{ projectSlug, issueId: session.issueId }}
                            className="link link-hover font-mono text-sm"
                          >
                            {session.issueShortId}
                          </Link>
                        ) : (
                          <span className="text-base-content/40">—</span>
                        )}
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3 text-sm"
                        >
                          {session.agent}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3 text-sm"
                        >
                          {formatRelativeTime(session.startedAt)}
                        </Link>
                      </td>
                      <td className="p-0">
                        <Link
                          to="/p/$projectSlug/sessions/$sessionId"
                          params={{ projectSlug, sessionId: session._id }}
                          className="block px-4 py-3 text-sm"
                        >
                          {formatDuration(session.startedAt, session.endedAt)}
                        </Link>
                      </td>
                    </tr>
                    {hasSummary && (
                      <tr className="bg-base-200/40">
                        <td
                          colSpan={8}
                          className={`border-base-300/60 border-t-0 px-0 pt-0 transition-[padding] duration-200 ${isExpanded ? "pb-3" : "pb-0"}`}
                        >
                          <div
                            className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out ${isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                          >
                            <div className="overflow-hidden">
                              <div
                                className={`ml-11 mr-4 rounded-lg border border-base-300/60 bg-base-100/80 px-4 py-3 shadow-sm transition-transform duration-200 ease-out ${isExpanded ? "translate-y-0" : "-translate-y-1"}`}
                              >
                                <div className="space-y-3">
                                  {summaryParts.map((part) => (
                                    <div key={part.label} className="space-y-1">
                                      <div className="font-medium text-base-content/70 text-xs uppercase tracking-wide">
                                        {part.label}
                                      </div>
                                      <p className="whitespace-pre-wrap break-words pl-4 text-sm leading-6">
                                        {part.content}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {paginationStatus === "CanLoadMore" && (
            <div className="flex justify-center py-4">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => loadMore(PAGE_SIZE)}
              >
                Load more sessions
              </button>
            </div>
          )}
          {paginationStatus === "LoadingMore" && (
            <div className="flex justify-center py-4">
              <span className="loading loading-spinner loading-sm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
