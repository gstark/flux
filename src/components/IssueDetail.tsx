import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { CloseType, IssuePriority, IssueStatus } from "$convex/schema";
import { StatusBadge } from "./StatusBadge";

type CloseTypeValue = (typeof CloseType)[keyof typeof CloseType];
type PriorityValue = (typeof IssuePriority)[keyof typeof IssuePriority];

const CLOSE_TYPE_LABELS: Record<CloseTypeValue, string> = {
  [CloseType.Completed]: "Completed",
  [CloseType.Wontfix]: "Won't Fix",
  [CloseType.Duplicate]: "Duplicate",
  [CloseType.Noop]: "No-op",
};

const PRIORITY_OPTIONS: { value: PriorityValue; label: string }[] = [
  { value: IssuePriority.Critical, label: "Critical" },
  { value: IssuePriority.High, label: "High" },
  { value: IssuePriority.Medium, label: "Medium" },
  { value: IssuePriority.Low, label: "Low" },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function IssueDetail({ issueId }: { issueId: Id<"issues"> }) {
  const issue = useQuery(api.issues.get, { issueId });
  const updateIssue = useMutation(api.issues.update);
  const closeIssue = useMutation(api.issues.close);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeType, setCloseType] = useState<CloseTypeValue>(
    CloseType.Completed,
  );
  const [closeReason, setCloseReason] = useState("");

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc) descTextareaRef.current?.focus();
  }, [editingDesc]);

  if (issue === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  if (issue === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-base-content/60">Issue not found.</p>
        <Link to="/issues" className="btn btn-sm">
          Back to Issues
        </Link>
      </div>
    );
  }

  // Captured after null checks — safe to use in handlers without non-null assertions
  const currentIssue = issue;
  const isClosed = currentIssue.status === IssueStatus.Closed;

  function startEditTitle() {
    setTitleDraft(currentIssue.title);
    setEditingTitle(true);
  }

  function saveTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== currentIssue.title) {
      updateIssue({ issueId, title: trimmed });
    }
    setEditingTitle(false);
  }

  function handleTitleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitle();
    } else if (e.key === "Escape") {
      setEditingTitle(false);
    }
  }

  function startEditDesc() {
    setDescDraft(currentIssue.description ?? "");
    setEditingDesc(true);
  }

  function saveDesc() {
    const trimmed = descDraft.trim();
    if (trimmed !== (currentIssue.description ?? "")) {
      updateIssue({ issueId, description: trimmed });
    }
    setEditingDesc(false);
  }

  function handleDescKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditingDesc(false);
    }
  }

  function handlePriorityChange(value: string) {
    updateIssue({ issueId, priority: value as PriorityValue });
  }

  function handleClose() {
    closeIssue({
      issueId,
      closeType,
      closeReason: closeReason.trim() || undefined,
    });
    setShowCloseForm(false);
    setCloseReason("");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link to="/issues" className="btn btn-ghost btn-sm">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          Back
        </Link>
        <span className="font-mono text-base-content/60 text-sm">
          {currentIssue.shortId}
        </span>
      </div>

      {/* Title */}
      <div>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            className="input input-bordered w-full font-semibold text-xl"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={handleTitleKeyDown}
          />
        ) : isClosed ? (
          <h1 className="font-semibold text-xl">{currentIssue.title}</h1>
        ) : (
          <button
            type="button"
            className="cursor-pointer text-left font-semibold text-xl hover:text-primary"
            onClick={startEditTitle}
            title="Click to edit"
          >
            {currentIssue.title}
          </button>
        )}
      </div>

      {/* Status + Priority row */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={currentIssue.status} />
        <select
          className="select select-bordered select-sm"
          value={currentIssue.priority}
          onChange={(e) => handlePriorityChange(e.target.value)}
          disabled={isClosed}
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {currentIssue.closeType && (
          <span className="badge badge-sm badge-outline">
            {CLOSE_TYPE_LABELS[currentIssue.closeType as CloseTypeValue]}
          </span>
        )}
      </div>

      {/* Description */}
      <div>
        <h3 className="mb-2 font-medium text-base-content/60 text-sm">
          Description
        </h3>
        {editingDesc ? (
          <textarea
            ref={descTextareaRef}
            className="textarea textarea-bordered min-h-32 w-full"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={handleDescKeyDown}
          />
        ) : isClosed ? (
          <div className="whitespace-pre-wrap rounded-lg bg-base-200 p-4">
            {currentIssue.description || (
              <span className="text-base-content/40 italic">
                No description.
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="w-full cursor-pointer whitespace-pre-wrap rounded-lg bg-base-200 p-4 text-left hover:ring-1 hover:ring-primary/30"
            onClick={startEditDesc}
            title="Click to edit"
          >
            {currentIssue.description || (
              <span className="text-base-content/40 italic">
                No description. Click to add one.
              </span>
            )}
          </button>
        )}
      </div>

      {/* Close action */}
      {!isClosed && (
        <div>
          {showCloseForm ? (
            <div className="flex flex-col gap-3 rounded-lg border border-error/30 bg-base-200 p-4">
              <h3 className="font-medium">Close Issue</h3>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="close-type-select"
                  className="font-medium text-sm"
                >
                  Type:
                </label>
                <select
                  id="close-type-select"
                  className="select select-bordered select-sm"
                  value={closeType}
                  onChange={(e) =>
                    setCloseType(e.target.value as CloseTypeValue)
                  }
                >
                  {Object.entries(CLOSE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="textarea textarea-bordered"
                placeholder="Reason (optional)"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-error btn-sm"
                  onClick={handleClose}
                >
                  Confirm Close
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowCloseForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-error btn-sm"
              onClick={() => setShowCloseForm(true)}
            >
              Close Issue
            </button>
          )}
        </div>
      )}

      {/* Close reason (for already-closed issues) */}
      {isClosed && currentIssue.closeReason && (
        <div className="rounded-lg bg-base-200 p-4">
          <h3 className="mb-1 font-medium text-base-content/60 text-sm">
            Close Reason
          </h3>
          <p className="whitespace-pre-wrap">{currentIssue.closeReason}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="rounded-lg bg-base-200 p-4">
        <h3 className="mb-3 font-medium text-base-content/60 text-sm">
          Metadata
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-base-content/60">ID</dt>
          <dd className="font-mono">{currentIssue.shortId}</dd>

          <dt className="text-base-content/60">Created</dt>
          <dd>{formatTime(currentIssue._creationTime)}</dd>

          {currentIssue.updatedAt && (
            <>
              <dt className="text-base-content/60">Updated</dt>
              <dd>{formatTime(currentIssue.updatedAt)}</dd>
            </>
          )}

          {currentIssue.closedAt && (
            <>
              <dt className="text-base-content/60">Closed</dt>
              <dd>{formatTime(currentIssue.closedAt)}</dd>
            </>
          )}

          {currentIssue.assignee && (
            <>
              <dt className="text-base-content/60">Assignee</dt>
              <dd>{currentIssue.assignee}</dd>
            </>
          )}

          <dt className="text-base-content/60">Failures</dt>
          <dd>{currentIssue.failureCount}</dd>

          {(currentIssue.reviewIterations ?? 0) > 0 && (
            <>
              <dt className="text-base-content/60">Review Iterations</dt>
              <dd>{currentIssue.reviewIterations}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
