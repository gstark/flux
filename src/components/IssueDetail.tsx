import { Link, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { CloseTypeValue, IssuePriorityValue } from "$convex/schema";
import { CommentAuthor, IssuePriority, IssueStatus } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { callTool } from "../lib/api";
import { CommentsThread } from "./CommentsThread";
import { DependencySection } from "./DependencySection";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faArrowLeft } from "./Icon";
import { IssueActionsToolbar } from "./IssueActionsToolbar";
import { CLOSE_TYPE_LABELS } from "./IssueCloseForm";
import { IssueDescriptionEditor } from "./IssueDescriptionEditor";
import { IssueMetadata } from "./IssueMetadata";
import { IssueTitleEditor } from "./IssueTitleEditor";
import { LabelBadge } from "./LabelBadge";
import { LabelPicker } from "./LabelPicker";
import { Markdown } from "./Markdown";
import { StatusBadge } from "./StatusBadge";

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
  const comments = useQuery(api.comments.list, { issueId });

  const [saving, setSaving] = useState(false);

  const [deferring, setDeferring] = useState(false);
  const [undeferring, setUndeferring] = useState(false);
  const [resetting, setResetting] = useState(false);

  const { error: mutationError, showError, clearError } = useDismissableError();

  useDocumentTitle(issue?.shortId);

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

  // Extract the most recent defer reason from Flux-authored "Deferred: ..." comments
  const DEFER_PREFIX = "Deferred: ";
  const deferReason = isDeferred
    ? (comments ?? [])
        .filter(
          (c) =>
            c.author === CommentAuthor.Flux &&
            c.content.startsWith(DEFER_PREFIX),
        )
        .at(-1)
        ?.content.slice(DEFER_PREFIX.length)
    : undefined;

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

  async function handleSaveTitle(newTitle: string) {
    setSaving(true);
    try {
      await updateIssue({ issueId, title: newTitle });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDescription(newDescription: string) {
    setSaving(true);
    try {
      await updateIssue({ issueId, description: newDescription });
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
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

  async function handleClose(
    closeType: CloseTypeValue,
    closeReason: string | undefined,
  ) {
    setSaving(true);
    try {
      await closeIssue({ issueId, closeType, closeReason });
    } catch (err) {
      showError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function handleDefer(note: string) {
    setDeferring(true);
    try {
      await callTool("issues_defer", {
        issueId,
        note,
      });
    } catch (err) {
      showError(err);
      throw err;
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
        <IssueTitleEditor
          title={currentIssue.title}
          isClosed={isClosed}
          busy={busy}
          onSave={handleSaveTitle}
        />
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
      <IssueDescriptionEditor
        description={currentIssue.description}
        isClosed={isClosed}
        busy={busy}
        onSave={handleSaveDescription}
      />

      {/* Actions toolbar — groups Reset, Defer/Undefer, and Close */}
      {!isClosed && (
        <IssueActionsToolbar
          showReset={isInProgress || isStuck}
          showDefer={!isDeferred}
          showUndefer={isDeferred}
          showClose={!isDeferred}
          busy={busy}
          resetting={resetting}
          deferring={deferring}
          undeferring={undeferring}
          saving={saving}
          onReset={handleResetToOpen}
          onDefer={handleDefer}
          onUndefer={handleUndefer}
          onClose={handleClose}
        />
      )}

      {/* Defer reason (for deferred issues) */}
      {isDeferred && deferReason && (
        <div className="rounded-lg bg-base-200 p-4">
          <h3 className="mb-1 font-medium text-base-content/60 text-sm">
            Defer Reason
          </h3>
          <Markdown content={deferReason} />
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
      <IssueMetadata
        shortId={currentIssue.shortId}
        creationTime={currentIssue._creationTime}
        updatedAt={currentIssue.updatedAt}
        closedAt={currentIssue.closedAt}
        assignee={currentIssue.assignee}
        failureCount={currentIssue.failureCount}
        reviewIterations={currentIssue.reviewIterations}
      />

      {/* Comments */}
      <CommentsThread issueId={issueId} />
    </div>
  );
}
