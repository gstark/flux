import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useProjectSlug } from "../hooks/useProjectId";
import { SessionTableRow } from "./SessionTableRow";

export function IssueSessionsList({ issueId }: { issueId: Id<"issues"> }) {
  const projectSlug = useProjectSlug();
  const sessions = useQuery(api.sessions.listByIssue, { issueId });
  const [expandedSessionIds, setExpandedSessionIds] = useState<
    Record<string, boolean>
  >({});

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
              <th className="w-0" aria-label="Expand session details" />
              <th>Type</th>
              <th>Phase</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => {
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
                  detailColSpan={7}
                  rowClassName="hover:bg-base-300"
                  mainLinkClassName="block px-4 py-2"
                  textLinkClassName="block px-4 py-2 text-sm"
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
