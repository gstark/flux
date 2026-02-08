import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { SessionStatusValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import {
  formatDuration,
  formatRelativeTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import { SessionStatusBadge } from "./SessionStatusBadge";

type StatusFilter = SessionStatusValue | null;

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Running", value: SessionStatus.Running },
  { label: "Completed", value: SessionStatus.Completed },
  { label: "Failed", value: SessionStatus.Failed },
];

const PAGE_SIZE = 50;

export function SessionList() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);

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

  const totalForStatus =
    sessionCounts === undefined
      ? undefined
      : statusFilter === null
        ? totalAll
        : (sessionCounts[statusFilter] ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-xl">Sessions</h2>
          {paginationStatus !== "LoadingFirstPage" &&
            totalForStatus !== undefined && (
              <span className="text-base-content/60 text-sm">
                {paginationStatus !== "Exhausted"
                  ? `showing ${sessions.length} of ${totalForStatus}`
                  : `${totalForStatus} ${totalForStatus === 1 ? "session" : "sessions"}`}
              </span>
            )}
        </div>
      </div>

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
                <th>Type</th>
                <th>Phase</th>
                <th>Status</th>
                <th>Issue</th>
                <th>Agent</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session._id}
                  className="cursor-pointer hover:bg-base-200"
                  onClick={() =>
                    navigate({
                      to: "/sessions/$sessionId",
                      params: { sessionId: session._id },
                    })
                  }
                >
                  <td>{typeLabel(session.type)}</td>
                  <td className="text-sm">
                    {session.phase ? phaseLabel(session.phase) : "—"}
                  </td>
                  <td>
                    <SessionStatusBadge status={session.status} />
                  </td>
                  <td>
                    {session.issueShortId ? (
                      <Link
                        to="/issues/$issueId"
                        params={{ issueId: session.issueId }}
                        className="link link-hover font-mono text-sm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {session.issueShortId}
                      </Link>
                    ) : (
                      <span className="text-base-content/40">—</span>
                    )}
                  </td>
                  <td className="text-sm">{session.agent}</td>
                  <td className="text-sm">
                    {formatRelativeTime(session.startedAt)}
                  </td>
                  <td className="text-sm">
                    {formatDuration(session.startedAt, session.endedAt)}
                  </td>
                </tr>
              ))}
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
