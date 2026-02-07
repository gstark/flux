import { Link, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { IssueStatus } from "$convex/schema";
import { callTool } from "../lib/api";
import { CreateIssueModal } from "./CreateIssueModal";
import { FontAwesomeIcon, faCirclePause, faCirclePlay } from "./Icon";
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

  // Defer modal state
  const [deferTargetId, setDeferTargetId] = useState<Id<"issues"> | null>(null);
  const [deferNote, setDeferNote] = useState("");
  const [deferring, setDeferring] = useState(false);
  const [deferError, setDeferError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undeferringId, setUndeferringId] = useState<Id<"issues"> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (deferTargetId) noteRef.current?.focus();
  }, [deferTargetId]);

  // Clear error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  function showActionError(err: unknown) {
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred";
    setActionError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setActionError(null), 8000);
  }

  function openDeferModal(issueId: Id<"issues">) {
    setDeferTargetId(issueId);
    setDeferNote("");
    setDeferError(null);
    dialogRef.current?.showModal();
  }

  function closeDeferModal() {
    dialogRef.current?.close();
    setDeferTargetId(null);
    setDeferNote("");
    setDeferError(null);
  }

  async function handleDefer() {
    if (!deferTargetId) return;
    setDeferring(true);
    setDeferError(null);
    try {
      await callTool("issues_defer", {
        issueId: deferTargetId,
        note: deferNote.trim() || "Deferred from UI",
      });
      closeDeferModal();
    } catch (err) {
      setDeferError(
        err instanceof Error ? err.message : "Failed to defer issue",
      );
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

  const issues = useQuery(api.issues.list, {
    projectId,
    status: statusFilter ?? undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-xl">Issues</h2>
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

      {actionError && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{actionError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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
                <th>Actions</th>
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
                        onClick={() => openDeferModal(issue._id)}
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
          {deferError && (
            <div role="alert" className="alert alert-error mt-3 text-sm">
              {deferError}
            </div>
          )}
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
