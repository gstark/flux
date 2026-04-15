import { Link } from "@tanstack/react-router";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { IssueStatusValue } from "$convex/schema";
import { IssueStatus, PRIORITY_ORDER } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import { useSessionState } from "../hooks/useSessionState";
import { DeferModal, type DeferModalHandle } from "./DeferModal";
import { ErrorBanner } from "./ErrorBanner";
import {
  FontAwesomeIcon,
  faCirclePause,
  faCirclePlay,
  faLayerGroup,
} from "./Icon";
import { PriorityBadge } from "./PriorityBadge";
import { SortableHeader, useSortableTable, useSorted } from "./SortableHeader";
import { StatusBadge } from "./StatusBadge";

type StatusFilter = IssueStatusValue | null;

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Open", value: IssueStatus.Open },
  { label: "In Progress", value: IssueStatus.InProgress },
  { label: "Closed", value: IssueStatus.Closed },
  { label: "Stuck", value: IssueStatus.Stuck },
  { label: "Deferred", value: IssueStatus.Deferred },
];

const PAGE_SIZE = 50;

const ISSUE_STATUS_ORDER: Record<string, number> = {
  [IssueStatus.InProgress]: 0,
  [IssueStatus.Open]: 1,
  [IssueStatus.Stuck]: 2,
  [IssueStatus.Deferred]: 3,
  [IssueStatus.Closed]: 4,
};

export function IssueList() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const [statusFilter, setStatusFilter] = useSessionState<StatusFilter>(
    `flux:${projectId}:issueTab`,
    IssueStatus.Open,
  );

  const undeferIssue = useMutation(api.issues.undefer);
  const deferRef = useRef<DeferModalHandle>(null);
  const {
    error: actionError,
    showError: showActionError,
    clearError: clearActionError,
  } = useDismissableError();
  const [undeferringId, setUndeferringId] = useState<Id<"issues"> | null>(null);

  async function handleUndefer(issueId: Id<"issues">) {
    setUndeferringId(issueId);
    try {
      await undeferIssue({ issueId });
    } catch (err) {
      showActionError(err);
    } finally {
      setUndeferringId(null);
    }
  }

  const {
    results: issues,
    status: paginationStatus,
    loadMore,
  } = usePaginatedQuery(
    api.issues.listPaginated,
    {
      projectId,
      status: statusFilter ?? undefined,
    },
    { initialNumItems: PAGE_SIZE },
  );

  const issueCounts = useQuery(api.issues.counts, { projectId });

  const allEpics = useQuery(api.epics.list, { projectId });
  const epicMap = new Map((allEpics ?? []).map((e) => [e._id, e]));

  const totalAllIssues =
    issueCounts === undefined
      ? undefined
      : Object.values(issueCounts).reduce((a, b) => a + b, 0);

  type IssueItem = (typeof issues)[number];
  type IssueSortKey = "id" | "title" | "status" | "priority";

  const { sort, toggle } = useSortableTable<IssueSortKey>({
    key: "id",
    direction: "desc",
  });
  const comparators = useMemo(
    () => ({
      id: (a: IssueItem, b: IssueItem) =>
        a.shortId.localeCompare(b.shortId, undefined, { numeric: true }),
      title: (a: IssueItem, b: IssueItem) => a.title.localeCompare(b.title),
      status: (a: IssueItem, b: IssueItem) =>
        (ISSUE_STATUS_ORDER[a.status] ?? 99) -
        (ISSUE_STATUS_ORDER[b.status] ?? 99),
      priority: (a: IssueItem, b: IssueItem) =>
        (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
    }),
    [],
  );
  const sortedIssues = useSorted(issues, sort, comparators);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="font-bold text-xl">Issues</h2>

      <div role="tablist" className="tabs tabs-box">
        {TABS.map((tab) => {
          const count =
            issueCounts === undefined
              ? undefined
              : tab.value === null
                ? totalAllIssues
                : (issueCounts[tab.value] ?? 0);
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

      <ErrorBanner error={actionError} onDismiss={clearActionError} />

      {paginationStatus === "LoadingFirstPage" ? (
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
                <SortableHeader
                  label="ID"
                  sortKey="id"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Title"
                  sortKey="title"
                  sort={sort}
                  onToggle={toggle}
                />
                <th>Epic</th>
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onToggle={toggle}
                />
                <SortableHeader
                  label="Priority"
                  sortKey="priority"
                  sort={sort}
                  onToggle={toggle}
                />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedIssues.map((issue) => (
                <tr key={issue._id} className="hover:bg-base-200">
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/issues/$issueId"
                      params={{ projectSlug, issueId: issue._id }}
                      className="block px-4 py-3"
                    >
                      <span className="font-mono text-sm">{issue.shortId}</span>
                    </Link>
                  </td>
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/issues/$issueId"
                      params={{ projectSlug, issueId: issue._id }}
                      className="block px-4 py-3"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="p-0">
                    {(() => {
                      const epic = issue.epicId
                        ? epicMap.get(issue.epicId)
                        : undefined;
                      if (!epic) {
                        return <span className="block px-4 py-3" />;
                      }
                      return (
                        <Link
                          to="/p/$projectSlug/epics/$epicId"
                          params={{ projectSlug, epicId: epic._id }}
                          className="block max-w-[14rem] truncate px-4 py-3 text-sm hover:underline"
                          title={epic.title}
                        >
                          <FontAwesomeIcon
                            icon={faLayerGroup}
                            className="mr-1.5 text-base-content/60"
                            aria-hidden="true"
                          />
                          {epic.title}
                        </Link>
                      );
                    })()}
                  </td>
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/issues/$issueId"
                      params={{ projectSlug, issueId: issue._id }}
                      className="block px-4 py-3"
                    >
                      <StatusBadge status={issue.status} />
                    </Link>
                  </td>
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/issues/$issueId"
                      params={{ projectSlug, issueId: issue._id }}
                      className="block px-4 py-3"
                    >
                      <PriorityBadge priority={issue.priority} />
                    </Link>
                  </td>
                  <td>
                    {issue.status === IssueStatus.Deferred ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => handleUndefer(issue._id)}
                        disabled={undeferringId === issue._id}
                      >
                        {undeferringId === issue._id ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <FontAwesomeIcon
                            icon={faCirclePlay}
                            aria-hidden="true"
                          />
                        )}
                        Undefer
                      </button>
                    ) : issue.status !== IssueStatus.Closed ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => deferRef.current?.open(issue._id)}
                      >
                        <FontAwesomeIcon
                          icon={faCirclePause}
                          aria-hidden="true"
                        />
                        Defer
                      </button>
                    ) : null}
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
                Load more issues
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

      <DeferModal ref={deferRef} />
    </div>
  );
}
