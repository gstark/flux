import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { IssueStatusValue } from "$convex/schema";
import { IssueStatus } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { callTool } from "../lib/api";
import { CreateIssueModal } from "./CreateIssueModal";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faCirclePause, faCirclePlay } from "./Icon";
import { LabelBadge } from "./LabelBadge";
import { PriorityBadge } from "./PriorityBadge";
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

export function IssueList() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    IssueStatus.Open,
  );

  // Defer modal state
  const [deferTargetId, setDeferTargetId] = useState<Id<"issues"> | null>(null);
  const [deferNote, setDeferNote] = useState("");
  const [deferring, setDeferring] = useState(false);
  const {
    error: deferError,
    showError: showDeferError,
    clearError: clearDeferError,
  } = useDismissableError();
  const {
    error: actionError,
    showError: showActionError,
    clearError: clearActionError,
  } = useDismissableError();
  const [undeferringId, setUndeferringId] = useState<Id<"issues"> | null>(null);
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (deferTargetId) noteRef.current?.focus();
  }, [deferTargetId]);

  function openDeferModal(issueId: Id<"issues">) {
    setDeferTargetId(issueId);
    setDeferNote("");
    clearDeferError();
    dialogRef.current?.showModal();
  }

  function closeDeferModal() {
    dialogRef.current?.close();
    setDeferTargetId(null);
    setDeferNote("");
    clearDeferError();
  }

  async function handleDefer() {
    if (!deferTargetId) return;
    setDeferring(true);
    clearDeferError();
    try {
      await callTool("issues_defer", {
        issueId: deferTargetId,
        note: deferNote.trim() || "Deferred from UI",
      });
      closeDeferModal();
    } catch (err) {
      showDeferError(err);
    } finally {
      setDeferring(false);
    }
  }

  async function handleUndefer(issueId: Id<"issues">) {
    setUndeferringId(issueId);
    try {
      await callTool("issues_undefer", {
        issueId,
        note: "Undeferred from UI",
      });
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

  const allLabels = useQuery(api.labels.list, { projectId });
  const labelMap = new Map((allLabels ?? []).map((l) => [l._id, l]));

  const totalAllIssues =
    issueCounts === undefined
      ? undefined
      : Object.values(issueCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl">Issues</h2>
        <CreateIssueModal />
      </div>

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
                <th>ID</th>
                <th>Title</th>
                <th>Labels</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue._id}
                  className="cursor-pointer hover:bg-base-200"
                  onClick={() =>
                    navigate({
                      to: "/issues/$issueId",
                      params: { issueId: issue._id },
                    })
                  }
                >
                  <td>
                    <span className="font-mono text-sm">{issue.shortId}</span>
                  </td>
                  <td>{issue.title}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(issue.labelIds ?? []).map((id) => {
                        const label = labelMap.get(id);
                        if (!label) return null;
                        return (
                          <LabelBadge
                            key={id}
                            name={label.name}
                            color={label.color}
                          />
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={issue.status} />
                  </td>
                  <td>
                    <PriorityBadge priority={issue.priority} />
                  </td>
                  <td>
                    {issue.status === IssueStatus.Deferred ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUndefer(issue._id);
                        }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          openDeferModal(issue._id);
                        }}
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

      {/* Defer modal */}
      <dialog ref={dialogRef} className="modal" onClose={closeDeferModal}>
        <div className="modal-box">
          <h3 className="mb-4 font-bold text-lg">Defer Issue</h3>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Reason (optional)</legend>
            <textarea
              ref={noteRef}
              className="textarea w-full"
              placeholder="Why is this being deferred?"
              value={deferNote}
              onChange={(e) => setDeferNote(e.target.value)}
              rows={3}
            />
          </fieldset>
          <ErrorBanner error={deferError} onDismiss={clearDeferError} />
          <div className="modal-action">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeDeferModal}
              disabled={deferring}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warning"
              onClick={handleDefer}
              disabled={deferring}
            >
              {deferring ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
              )}
              Defer
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
    </div>
  );
}
