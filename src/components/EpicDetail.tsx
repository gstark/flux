import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { EpicStatus, IssueStatus } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProjectSlug } from "../hooks/useProjectId";
import { ErrorBanner } from "./ErrorBanner";
import {
  FontAwesomeIcon,
  faArrowLeft,
  faCircleXmark,
  faLayerGroup,
  faPen,
} from "./Icon";
import { Markdown } from "./Markdown";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";

export function EpicDetail({ epicId }: { epicId: Id<"epics"> }) {
  const projectSlug = useProjectSlug();
  const epic = useQuery(api.epics.show, { epicId });
  const updateEpic = useMutation(api.epics.update);
  const closeEpic = useMutation(api.epics.close);

  const { error, showError, clearError } = useDismissableError();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  useDocumentTitle(epic?.title);

  if (epic === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  if (epic === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-8">
        <p className="text-base-content/60">Epic not found.</p>
        <Link
          to="/p/$projectSlug/epics"
          params={{ projectSlug }}
          className="btn btn-sm"
        >
          Back to Epics
        </Link>
      </div>
    );
  }

  const isClosed = epic.status === EpicStatus.Closed;

  function startEdit() {
    if (!epic) return;
    setTitle(epic.title);
    setDescription(epic.description ?? "");
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!epic) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    clearError();
    try {
      await updateEpic({
        epicId: epic._id,
        title: trimmed,
        description: description.trim() || undefined,
      });
      setEditing(false);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!epic) return;
    setClosing(true);
    clearError();
    try {
      await closeEpic({ epicId: epic._id });
    } catch (err) {
      showError(err);
    } finally {
      setClosing(false);
    }
  }

  // Sort child issues: open/in-progress first, closed last; then by creation time desc
  const sortedIssues = [...epic.issues].sort((a, b) => {
    const aClosed = a.status === IssueStatus.Closed ? 1 : 0;
    const bClosed = b.status === IssueStatus.Closed ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return b._creationTime - a._creationTime;
  });

  const openCount = epic.issues.filter(
    (i) => i.status !== IssueStatus.Closed,
  ).length;
  const closedCount = epic.issues.length - openCount;

  return (
    <div className="flex flex-col gap-6 p-6">
      <ErrorBanner error={error} onDismiss={clearError} />

      {/* Header */}
      <div className="flex items-center gap-2">
        <Link
          to="/p/$projectSlug/epics"
          params={{ projectSlug }}
          className="btn btn-ghost btn-sm"
        >
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
          Back
        </Link>
        <FontAwesomeIcon
          icon={faLayerGroup}
          className="text-base-content/60"
          aria-hidden="true"
        />
        <span className="text-base-content/60 text-sm">Epic</span>
      </div>

      {/* Title + status */}
      {editing ? (
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <input
            type="text"
            className="input input-lg w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="textarea w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (markdown supported)"
            rows={6}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={saving || !title.trim()}
            >
              {saving && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-bold text-2xl">{epic.title}</h1>
            <span
              className={`badge ${isClosed ? "badge-ghost" : "badge-primary"}`}
            >
              {epic.status}
            </span>
            {!isClosed && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={startEdit}
              >
                <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                Edit
              </button>
            )}
          </div>
          {epic.description ? (
            <div className="rounded-lg bg-base-200 p-4">
              <Markdown content={epic.description} />
            </div>
          ) : (
            <p className="text-base-content/40 text-sm">No description</p>
          )}
        </div>
      )}

      {/* Close action */}
      {!isClosed && !editing && (
        <div>
          <button
            type="button"
            className="btn btn-outline btn-error btn-sm"
            onClick={handleClose}
            disabled={closing}
          >
            {closing ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <FontAwesomeIcon icon={faCircleXmark} aria-hidden="true" />
            )}
            Close Epic
          </button>
        </div>
      )}

      {isClosed && epic.closeReason && (
        <div className="rounded-lg bg-base-200 p-4">
          <h3 className="mb-1 font-medium text-base-content/60 text-sm">
            Close Reason
          </h3>
          <Markdown content={epic.closeReason} />
        </div>
      )}

      {/* Issues */}
      <div>
        <h2 className="mb-2 font-semibold text-lg">
          Issues
          <span className="ml-2 text-base-content/60 text-sm">
            {openCount} open · {closedCount} closed
          </span>
        </h2>
        {sortedIssues.length === 0 ? (
          <p className="text-base-content/60 text-sm">
            No issues in this epic yet.
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
                {sortedIssues.map((issue) => (
                  <tr key={issue._id} className="hover:bg-base-200">
                    <td className="p-0">
                      <Link
                        to="/p/$projectSlug/issues/$issueId"
                        params={{ projectSlug, issueId: issue._id }}
                        className="block px-4 py-3 font-mono text-sm"
                      >
                        {issue.shortId}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
