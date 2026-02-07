import { Link, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import { IssueStatus } from "$convex/schema";
import { CreateIssueModal } from "./CreateIssueModal";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";

type StatusFilter = (typeof IssueStatus)[keyof typeof IssueStatus] | null;

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Open", value: IssueStatus.Open },
  { label: "In Progress", value: IssueStatus.InProgress },
  { label: "Closed", value: IssueStatus.Closed },
  { label: "Stuck", value: IssueStatus.Stuck },
  { label: "Deferred", value: IssueStatus.Deferred },
];

export function IssueList() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);

  const issues = useQuery(api.issues.list, {
    projectId,
    status: statusFilter ?? undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-xl">Issues</h2>
          {issues && (
            <span className="text-base-content/60 text-sm">
              {issues.length} {issues.length === 1 ? "issue" : "issues"}
            </span>
          )}
        </div>
        <CreateIssueModal />
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

      {issues === undefined ? (
        <div className="flex justify-center p-8">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : issues.length === 0 ? (
        <p className="py-8 text-center text-base-content/60">
          No issues found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-zebra table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue._id} className="hover:bg-base-200">
                  <td>
                    <Link
                      to="/issues/$issueId"
                      params={{ issueId: issue._id }}
                      className="link link-hover font-mono text-sm"
                    >
                      {issue.shortId}
                    </Link>
                  </td>
                  <td>
                    <Link
                      to="/issues/$issueId"
                      params={{ issueId: issue._id }}
                      className="link link-hover"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={issue.status} />
                  </td>
                  <td>
                    <PriorityBadge priority={issue.priority} />
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
