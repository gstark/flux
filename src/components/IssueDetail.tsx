import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { CloseTypeValue, IssuePriorityValue } from "$convex/schema";
import { IssueStatus, SessionStatus } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import { useTrackedAction } from "../hooks/useTrackedAction";
import { PRIORITY_OPTIONS } from "../lib/format";
import { CommentsThread } from "./CommentsThread";
import { DependencySection } from "./DependencySection";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faArrowLeft, faLayerGroup } from "./Icon";
import { IssueActionsToolbar } from "./IssueActionsToolbar";
import { CLOSE_TYPE_LABELS } from "./IssueCloseForm";
import { IssueDescriptionEditor } from "./IssueDescriptionEditor";
import { IssueMetadata } from "./IssueMetadata";
import { IssueSessionsList } from "./IssueSessionsList";
import { IssueTitleEditor } from "./IssueTitleEditor";
import { Markdown } from "./Markdown";
import { StatusBadge } from "./StatusBadge";

export function IssueDetail({ issueId }: { issueId: Id<"issues"> }) {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const issue = useQuery(api.issues.get, { issueId });
  const allEpics = useQuery(api.epics.list, { projectId });
  const runningSessions = useQuery(api.sessions.listByIssue, {
    issueId,
    status: SessionStatus.Running,
  });
  const updateIssue = useMutation(api.issues.update);
  const retryIssue = useMutation(api.issues.retry);
  const closeIssue = useMutation(api.issues.close);
  const deferIssue = useMutation(api.issues.defer);
  const undeferIssue = useMutation(api.issues.undefer);

  const { error: mutationError, showError, clearError } = useDismissableError();

  // Each tracked action manages its own pending boolean.
  // Actions that use `rethrow` propagate failures to child forms so they can
  // keep their UI open on error.

  const [handleSaveTitle, titleSaving] = useTrackedAction(
    async (newTitle: string) => {
      await updateIssue({ issueId, title: newTitle });
    },
    showError,
  );

  const [handleSaveDescription, descriptionSaving] = useTrackedAction(
    async (newDescription: string) => {
      await updateIssue({ issueId, description: newDescription });
    },
    showError,
  );

  const [handlePriorityChange, prioritySaving] = useTrackedAction(
    async (value: string) => {
      await updateIssue({ issueId, priority: value as IssuePriorityValue });
    },
    showError,
  );

  const [handleEpicChange, epicSaving] = useTrackedAction(
    async (value: string) => {
      await updateIssue({
        issueId,
        epicId: value === "" ? null : (value as Id<"epics">),
      });
    },
    showError,
  );

  const [handleClose, closeSaving] = useTrackedAction(
    async (closeType: CloseTypeValue, closeReason: string | undefined) => {
      await closeIssue({ issueId, closeType, closeReason });
    },
    showError,
    { rethrow: true },
  );

  const [handleDefer, deferring] = useTrackedAction(
    async (note: string) => {
      await deferIssue({ issueId, note });
    },
    showError,
    { rethrow: true },
  );

  const [handleUndefer, undeferring] = useTrackedAction(async () => {
    await undeferIssue({ issueId });
  }, showError);

  const [handleResetToOpen, resetting] = useTrackedAction(async () => {
    // issue is guaranteed non-null when this button is visible
    if (issue?.status === IssueStatus.Stuck) {
      await retryIssue({ issueId });
    } else {
      await updateIssue({ issueId, status: IssueStatus.Open });
    }
  }, showError);

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
        <Link
          to="/p/$projectSlug/issues"
          params={{ projectSlug }}
          className="btn btn-sm"
        >
          Back to Issues
        </Link>
      </div>
    );
  }

  // Captured after null checks — safe to use in JSX without non-null assertions
  const currentIssue = issue;
  const activeSession = runningSessions?.at(-1) ?? null;
  const isClosed = currentIssue.status === IssueStatus.Closed;
  const isDeferred = currentIssue.status === IssueStatus.Deferred;
  const isInProgress = currentIssue.status === IssueStatus.InProgress;
  const isStuck = currentIssue.status === IssueStatus.Stuck;

  // Read defer reason directly from the issue field (set by defer mutation)
  const deferReason = isDeferred ? currentIssue.deferNote : undefined;

  // Any mutation in flight — disables interactive controls
  const saving =
    titleSaving ||
    descriptionSaving ||
    prioritySaving ||
    epicSaving ||
    closeSaving;
  const busy = saving || deferring || undeferring || resetting;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Mutation error banner */}
      <ErrorBanner error={mutationError} onDismiss={clearError} />

      {/* Header */}
      <div className="flex items-center gap-2">
        <Link
          to="/p/$projectSlug/issues"
          params={{ projectSlug }}
          className="btn btn-ghost btn-sm"
        >
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
        {activeSession ? (
          <Link
            to="/p/$projectSlug/sessions/$sessionId"
            params={{ projectSlug, sessionId: activeSession._id }}
            className="inline-flex"
            title="Open active session"
          >
            <StatusBadge status={currentIssue.status} />
          </Link>
        ) : (
          <StatusBadge status={currentIssue.status} />
        )}
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

      {/* Epic */}
      <div>
        <h3 className="mb-1 font-medium text-base-content/60 text-sm">Epic</h3>
        {isClosed ? (
          currentIssue.epicId ? (
            (() => {
              const epic = (allEpics ?? []).find(
                (e) => e._id === currentIssue.epicId,
              );
              if (!epic) {
                return (
                  <p className="text-base-content/40 text-sm">
                    (epic unavailable)
                  </p>
                );
              }
              return (
                <Link
                  to="/p/$projectSlug/epics/$epicId"
                  params={{ projectSlug, epicId: epic._id }}
                  className="inline-flex items-center gap-1.5 text-sm hover:underline"
                >
                  <FontAwesomeIcon
                    icon={faLayerGroup}
                    className="text-base-content/60"
                    aria-hidden="true"
                  />
                  {epic.title}
                </Link>
              );
            })()
          ) : (
            <p className="text-base-content/40 text-sm">No epic</p>
          )
        ) : (
          <div className="flex items-center gap-2">
            <select
              className="select select-sm"
              value={currentIssue.epicId ?? ""}
              onChange={(e) => handleEpicChange(e.target.value)}
              disabled={busy || allEpics === undefined}
            >
              <option value="">No epic</option>
              {(allEpics ?? []).map((epic) => (
                <option key={epic._id} value={epic._id}>
                  {epic.title}
                </option>
              ))}
            </select>
            {currentIssue.epicId &&
              (() => {
                const epic = (allEpics ?? []).find(
                  (e) => e._id === currentIssue.epicId,
                );
                if (!epic) return null;
                return (
                  <Link
                    to="/p/$projectSlug/epics/$epicId"
                    params={{ projectSlug, epicId: epic._id }}
                    className="btn btn-ghost btn-sm"
                    title={`Open epic: ${epic.title}`}
                  >
                    <FontAwesomeIcon icon={faLayerGroup} aria-hidden="true" />
                    Open
                  </Link>
                );
              })()}
          </div>
        )}
      </div>

      {/* Dependencies */}
      <DependencySection
        issueId={issueId}
        disabled={isClosed || busy}
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
          closing={closeSaving}
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

      {/* Sessions */}
      <IssueSessionsList issueId={issueId} />

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
