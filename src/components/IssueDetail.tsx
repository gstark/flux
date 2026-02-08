import { Link, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { CloseTypeValue, IssuePriorityValue } from "$convex/schema";
import { CloseType, IssuePriority, IssueStatus } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { callTool } from "../lib/api";
import { formatTime } from "../lib/format";
import { CommentsThread } from "./CommentsThread";
import { DependencySection } from "./DependencySection";
import { ErrorBanner } from "./ErrorBanner";
import {
  FontAwesomeIcon,
  faArrowLeft,
  faArrowRotateLeft,
  faCirclePause,
  faCirclePlay,
  faCircleXmark,
} from "./Icon";
import { LabelBadge } from "./LabelBadge";
import { LabelPicker } from "./LabelPicker";
import { Markdown } from "./Markdown";
import { StatusBadge } from "./StatusBadge";

const CLOSE_TYPE_LABELS: Record<CloseTypeValue, string> = {
  [CloseType.Completed]: "Completed",
  [CloseType.Wontfix]: "Won't Fix",
  [CloseType.Duplicate]: "Duplicate",
  [CloseType.Noop]: "No-op",
};

const PRIORITY_OPTIONS: { value: IssuePriorityValue; label: string }[] = [
  { value: IssuePriority.Critical, label: "Critical" },
  { value: IssuePriority.High, label: "High" },
  { value: IssuePriority.Medium, label: "Medium" },
  { value: IssuePriority.Low, label: "Low" },
];

export function IssueDetail({ issueId }: { issueId: Id<"issues"> }) {
  const { projectId } = useRouteContext({ from: "__root__" });
  const issue = useQuery(api.issues.get, { issueId });
  const allLabels = useQuery(api.labels.list, { projectId });
  const updateIssue = useMutation(api.issues.update);
  const unstickIssue = useMutation(api.issues.unstick);
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

  const [saving, setSaving] = useState(false);

  const [showDeferForm, setShowDeferForm] = useState(false);
  const [deferNote, setDeferNote] = useState("");
  const [deferring, setDeferring] = useState(false);
  const [undeferring, setUndeferring] = useState(false);
  const [resetting, setResetting] = useState(false);

  const { error: mutationError, showError, clearError } = useDismissableError();

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
  const isDeferred = currentIssue.status === IssueStatus.Deferred;
  const isInProgress = currentIssue.status === IssueStatus.InProgress;
  const isStuck = currentIssue.status === IssueStatus.Stuck;

  // Any mutation in flight — disables interactive controls
  const busy = saving || deferring || undeferring || resetting;

  // Build a lookup map for label data
  const labelMap = new Map((allLabels ?? []).map((l) => [l._id, l]));
  const assignedLabels = (currentIssue.labelIds ?? [])
    .map((id) => labelMap.get(id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);

  async function handleLabelsChange(labelIds: Id<"labels">[]) {
    setSaving(true);
    try {
      await updateIssue({ issueId, labelIds });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  function startEditTitle() {
    setTitleDraft(currentIssue.title);
    setEditingTitle(true);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== currentIssue.title) {
      setSaving(true);
      try {
        await updateIssue({ issueId, title: trimmed });
      } catch (err) {
        showError(err);
      } finally {
        setSaving(false);
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
      setSaving(true);
      try {
        await updateIssue({ issueId, description: trimmed });
      } catch (err) {
        showError(err);
      } finally {
        setSaving(false);
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
    setSaving(true);
    try {
      await updateIssue({ issueId, priority: value as IssuePriorityValue });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  async function handleDefer() {
    setDeferring(true);
    try {
      await callTool("issues_defer", {
        issueId,
        note: deferNote.trim() || "Deferred from UI",
      });
      setShowDeferForm(false);
      setDeferNote("");
    } catch (err) {
      showError(err);
    } finally {
      setDeferring(false);
    }
  }

  async function handleUndefer() {
    setUndeferring(true);
    try {
      await callTool("issues_undefer", {
        issueId,
        note: "Undeferred from UI",
      });
    } catch (err) {
      showError(err);
    } finally {
      setUndeferring(false);
    }
  }

  async function handleResetToOpen() {
    setResetting(true);
    try {
      if (isStuck) {
        await unstickIssue({ issueId });
      } else {
        await updateIssue({ issueId, status: IssueStatus.Open });
      }
    } catch (err) {
      showError(err);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Mutation error banner */}
      <ErrorBanner error={mutationError} onDismiss={clearError} />

      {/* Header */}
      <div className="flex items-center gap-2">
        <Link to="/issues" className="btn btn-ghost btn-sm">
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
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
            className="input w-full font-semibold text-xl"
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
            className="cursor-pointer text-left font-semibold text-xl hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={startEditTitle}
            title="Click to edit"
            disabled={busy}
          >
            {currentIssue.title}
          </button>
        )}
      </div>

      {/* Status + Priority row */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={currentIssue.status} />
        <select
          className="select select-sm"
          value={currentIssue.priority}
          onChange={(e) => handlePriorityChange(e.target.value)}
          disabled={isClosed || busy}
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
              disabled={busy}
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
            className="textarea min-h-32 w-full"
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
            className="w-full cursor-pointer rounded-lg bg-base-200 p-4 text-left hover:ring-1 hover:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={startEditDesc}
            title="Click to edit"
            disabled={busy}
          >
            <Markdown
              content={currentIssue.description}
              placeholder="No description. Click to add one."
            />
          </button>
        )}
      </div>

      {/* Reset to Open — for in_progress (stranded) or stuck issues */}
      {(isInProgress || isStuck) && (
        <div>
          <button
            type="button"
            className="btn btn-outline btn-info btn-sm"
            onClick={handleResetToOpen}
            disabled={busy}
          >
            {resetting ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <FontAwesomeIcon icon={faArrowRotateLeft} aria-hidden="true" />
            )}
            Reset to Open
          </button>
        </div>
      )}

      {/* Defer action */}
      {!isClosed && !isDeferred && (
        <div>
          {showDeferForm ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-base-200 p-4">
              <h3 className="font-medium">Defer Issue</h3>
              <textarea
                className="textarea"
                placeholder="Reason for deferring (optional)"
                value={deferNote}
                onChange={(e) => setDeferNote(e.target.value)}
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  onClick={handleDefer}
                  disabled={busy}
                >
                  {deferring ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
                  )}
                  Confirm Defer
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setShowDeferForm(false);
                    setDeferNote("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline btn-warning btn-sm"
              onClick={() => setShowDeferForm(true)}
              disabled={busy}
            >
              <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
              Defer Issue
            </button>
          )}
        </div>
      )}

      {/* Undefer action */}
      {isDeferred && (
        <div>
          <button
            type="button"
            className="btn btn-outline btn-info btn-sm"
            onClick={handleUndefer}
            disabled={busy}
          >
            {undeferring ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <FontAwesomeIcon icon={faCirclePlay} aria-hidden="true" />
            )}
            Undefer Issue
          </button>
        </div>
      )}

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
                  className="select select-sm"
                  value={closeType}
                  onChange={(e) =>
                    setCloseType(e.target.value as CloseTypeValue)
                  }
                  disabled={busy}
                >
                  {Object.entries(CLOSE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="textarea"
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
                  disabled={busy}
                >
                  {saving ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <FontAwesomeIcon icon={faCircleXmark} aria-hidden="true" />
                  )}
                  Confirm Close
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowCloseForm(false)}
                  disabled={busy}
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
              disabled={busy}
            >
              <FontAwesomeIcon icon={faCircleXmark} aria-hidden="true" />
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
