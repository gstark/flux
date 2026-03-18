import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { SessionStatusValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
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
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
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
                <tr key={session._id} className="hover:bg-base-200">
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
                    {session.issueShortId ? (
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
