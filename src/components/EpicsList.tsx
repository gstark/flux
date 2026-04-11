import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import { EpicStatus, type EpicStatusValue } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { useProjectId, useProjectSlug } from "../hooks/useProjectId";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faLayerGroup, faPlus } from "./Icon";

type StatusFilter = EpicStatusValue | null;

const TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: null },
  { label: "Open", value: EpicStatus.Open },
  { label: "Closed", value: EpicStatus.Closed },
];

export function EpicsList() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const epics = useQuery(api.epics.list, {
    projectId,
    status: statusFilter ?? undefined,
  });
  const createEpic = useMutation(api.epics.create);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { error, showError, clearError } = useDismissableError();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    clearError();
    try {
      await createEpic({
        projectId,
        title: trimmed,
        description: description.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      setShowCreate(false);
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl">Epics</h1>
        {!showCreate && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            New Epic
          </button>
        )}
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

      <ErrorBanner error={error} onDismiss={clearError} />

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-200 p-4"
        >
          <fieldset className="fieldset">
            <legend className="fieldset-legend">
              Title <span className="text-error">*</span>
            </legend>
            <input
              type="text"
              className="input w-full"
              placeholder="Epic title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </fieldset>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Description</legend>
            <textarea
              className="textarea w-full"
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </fieldset>
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting || !title.trim()}
            >
              {submitting && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Create Epic
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowCreate(false);
                setTitle("");
                setDescription("");
                clearError();
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {epics === undefined ? (
        <div className="flex justify-center p-8">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : epics.length === 0 ? (
        <p className="py-8 text-center text-base-content/60">
          No epics yet. Create one to group related issues.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-zebra table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {epics.map((epic) => (
                <tr key={epic._id} className="hover:bg-base-200">
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/epics/$epicId"
                      params={{ projectSlug, epicId: epic._id }}
                      className="block px-4 py-3"
                    >
                      <FontAwesomeIcon
                        icon={faLayerGroup}
                        className="mr-2 text-base-content/60"
                        aria-hidden="true"
                      />
                      {epic.title}
                    </Link>
                  </td>
                  <td className="p-0">
                    <Link
                      to="/p/$projectSlug/epics/$epicId"
                      params={{ projectSlug, epicId: epic._id }}
                      className="block px-4 py-3"
                    >
                      <span
                        className={`badge badge-sm ${
                          epic.status === EpicStatus.Open
                            ? "badge-primary"
                            : "badge-ghost"
                        }`}
                      >
                        {epic.status}
                      </span>
                    </Link>
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
