import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import { SessionStatus, SessionType } from "$convex/schema";
import { SessionStatusBadge } from "./SessionStatusBadge";

type StatusFilter = (typeof SessionStatus)[keyof typeof SessionStatus] | null;
type SessionTypeValue = (typeof SessionType)[keyof typeof SessionType];

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Running", value: SessionStatus.Running },
  { label: "Completed", value: SessionStatus.Completed },
  { label: "Failed", value: SessionStatus.Failed },
];

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

function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: number, endedAt?: number): string {
  if (!endedAt) return "—";
  const seconds = Math.floor((endedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function SessionList() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const navigate = useNavigate();

  const sessions = useQuery(api.sessions.listWithIssues, {
    projectId,
    status: statusFilter ?? undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-xl">Sessions</h2>
          {sessions && (
            <span className="text-base-content/60 text-sm">
              {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            </span>
          )}
        </div>
      </div>

      <div role="tablist" className="tabs tabs-box">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            role="tab"
            type="button"
            className={`tab ${statusFilter === tab.value ? "tab-active" : ""}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {sessions === undefined ? (
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
                <th>Session</th>
                <th>Type</th>
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
                  <td className="font-mono text-sm">{session._id.slice(-8)}</td>
                  <td>{typeLabel(session.type)}</td>
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
        </div>
      )}
    </div>
  );
}
