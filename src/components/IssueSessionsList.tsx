import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useProjectSlug } from "../hooks/useProjectId";
import {
  formatDuration,
  formatRelativeTime,
  phaseLabel,
  typeLabel,
} from "../lib/format";
import { SessionStatusBadge } from "./SessionStatusBadge";

export function IssueSessionsList({ issueId }: { issueId: Id<"issues"> }) {
  const projectSlug = useProjectSlug();
  const sessions = useQuery(api.sessions.listByIssue, { issueId });

  if (sessions === undefined) {
    return null; // Loading — don't flash empty state
  }

  if (sessions.length === 0) {
    return null; // No sessions yet — hide the section entirely
  }

  return (
    <div className="rounded-lg bg-base-200 p-4">
      <h3 className="mb-3 font-medium text-base-content/60 text-sm">
        Sessions
      </h3>
      <div className="overflow-x-auto">
        <table className="table-sm table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Phase</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session._id} className="hover:bg-base-300">
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="link link-hover block px-4 py-2 text-sm"
                  >
                    {typeLabel(session.type)}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="block px-4 py-2 text-sm"
                  >
                    {session.phase ? phaseLabel(session.phase) : "—"}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="block px-4 py-2"
                  >
                    <SessionStatusBadge status={session.status} />
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="block px-4 py-2 text-sm"
                  >
                    {session.agent}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="block px-4 py-2 text-sm"
                  >
                    {formatRelativeTime(session.startedAt)}
                  </Link>
                </td>
                <td className="p-0">
                  <Link
                    to="/p/$projectSlug/sessions/$sessionId"
                    params={{ projectSlug, sessionId: session._id }}
                    className="block px-4 py-2 text-sm"
                  >
                    {formatDuration(session.startedAt, session.endedAt)}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
