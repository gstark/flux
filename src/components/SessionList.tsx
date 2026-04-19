import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "$convex/_generated/api";
import type { SessionStatusValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import { SessionTableRow } from "./SessionTableRow";
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

export function SessionList() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<
    Record<string, boolean>
  >({});

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
                const isExpanded = expandedSessionIds[session._id] ?? false;

                return (
                  <SessionTableRow
                    key={session._id}
                    session={session}
                    projectSlug={projectSlug}
                    isExpanded={isExpanded}
                    onToggleExpanded={() =>
                      setExpandedSessionIds((current) => ({
                        ...current,
                        [session._id]: !current[session._id],
                      }))
                    }
                    detailColSpan={8}
                    rowClassName="hover:bg-base-200"
                    extraCells={
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
                    }
                  />
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
