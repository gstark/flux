import { Link, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { CloseType, IssuePriority, IssueStatus } from "$convex/schema";
import { CommentsThread } from "./CommentsThread";
import { DependencySection } from "./DependencySection";
import { LabelBadge } from "./LabelBadge";
import { LabelPicker } from "./LabelPicker";
import { Markdown } from "./Markdown";
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
  const { projectId } = useRouteContext({ from: "__root__" });
  const issue = useQuery(api.issues.get, { issueId });
  const allLabels = useQuery(api.labels.list, { projectId });
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

  const [mutationError, setMutationError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  useEffect(() => {
    if (editingDesc) descTextareaRef.current?.focus();
  }, [editingDesc]);

  // Clear error timer on unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

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

  // Build a lookup map for label data
  const labelMap = new Map((allLabels ?? []).map((l) => [l._id, l]));
  const assignedLabels = (currentIssue.labelIds ?? [])
    .map((id) => labelMap.get(id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);

  async function handleLabelsChange(labelIds: Id<"labels">[]) {
    try {
      await updateIssue({ issueId, labelIds });
    } catch (err) {
      showError(err);
    }
  }

  function showError(err: unknown) {
    setMutationError(
      err instanceof Error ? err.message : "An unexpected error occurred",
    );
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setMutationError(null), 8000);
  }

  function startEditTitle() {
    setTitleDraft(currentIssue.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== currentIssue.title) {
      try {
        await updateIssue({ issueId, title: trimmed });
      } catch (err) {
        showError(err);
      }
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

  async function saveDesc() {
    const trimmed = descDraft.trim();
    if (trimmed !== (currentIssue.description ?? "")) {
      try {
        await updateIssue({ issueId, description: trimmed });
      } catch (err) {
        showError(err);
      }
    }
    setEditingDesc(false);
  }

  function handleDescKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditingDesc(false);
    }
  }

  async function handlePriorityChange(value: string) {
    try {
      await updateIssue({ issueId, priority: value as PriorityValue });
    } catch (err) {
      showError(err);
    }
  }

  async function handleClose() {
    try {
      await closeIssue({
        issueId,
        closeType,
        closeReason: closeReason.trim() || undefined,
      });
      setShowCloseForm(false);
      setCloseReason("");
    } catch (err) {
      showError(err);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Mutation error banner */}
      {mutationError && (
        <div role="alert" className="alert alert-error text-sm">
          <span>{mutationError}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setMutationError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

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

      {/* Labels */}
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-base-content/60 text-sm">Labels</h3>
          {!isClosed && (
            <LabelPicker
              selectedIds={currentIssue.labelIds ?? []}
              onChange={handleLabelsChange}
            />
          )}
        </div>
        {assignedLabels.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {assignedLabels.map((label) => (
              <LabelBadge
                key={label._id}
                name={label.name}
                color={label.color}
              />
            ))}
          </div>
        ) : (
          <p className="mt-1 text-base-content/40 text-sm">No labels</p>
        )}
      </div>

      {/* Dependencies */}
      <DependencySection
        issueId={issueId}
        disabled={isClosed}
        onError={showError}
      />

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
          <div className="rounded-lg bg-base-200 p-4">
            <Markdown
              content={currentIssue.description}
              placeholder="No description."
            />
          </div>
        ) : (
          <button
            type="button"
            className="w-full cursor-pointer rounded-lg bg-base-200 p-4 text-left hover:ring-1 hover:ring-primary/30"
            onClick={startEditDesc}
            title="Click to edit"
          >
            <Markdown
              content={currentIssue.description}
              placeholder="No description. Click to add one."
            />
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
          <Markdown content={currentIssue.closeReason} />
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

      {/* Comments */}
      <CommentsThread issueId={issueId} />
    </div>
  );
}
