import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Doc } from "$convex/_generated/dataModel";
import { useDismissableError } from "../hooks/useDismissableError";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faPen, faTrash } from "./Icon";
import { ProjectStateBadge } from "./ProjectStateBadge";

type Project = Doc<"projects">;

export function ProjectRow({ project }: { project: Project }) {
  const updateProject = useMutation(api.projects.update);
  const removeProject = useMutation(api.projects.remove);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [slugDraft, setSlugDraft] = useState(project.slug);
  const [pathDraft, setPathDraft] = useState(project.path ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const { error, showError, clearError } = useDismissableError();

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setNameDraft(project.name);
    setSlugDraft(project.slug);
    setPathDraft(project.path ?? "");
    setConfirmDelete(false);
    setEditing(true);
    clearError();
  }

  function cancelEdit() {
    setEditing(false);
    clearError();
  }

  async function saveEdit() {
    if (saving) return;

    const trimmedName = nameDraft.trim();
    const trimmedSlug = slugDraft.trim();
    const trimmedPath = pathDraft.trim();

    if (!trimmedName || !trimmedSlug) {
      showError("Name and slug are required");
      return;
    }

    const nameChanged = trimmedName !== project.name;
    const slugChanged = trimmedSlug !== project.slug;
    const pathChanged = trimmedPath !== (project.path ?? "");

    if (!nameChanged && !slugChanged && !pathChanged) {
      setEditing(false);
      return;
    }

    // If path changed, use REST API for server-side validation
    if (pathChanged) {
      setSaving(true);
      try {
        const res = await fetch(`/api/projects/${project._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(nameChanged ? { name: trimmedName } : {}),
            ...(slugChanged ? { slug: trimmedSlug } : {}),
            path: trimmedPath,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(data?.error ?? `Update failed (${res.status})`);
        }
        setEditing(false);
        clearError();
      } catch (err) {
        showError(err);
      } finally {
        setSaving(false);
      }
      return;
    }

    // No path change — use Convex mutation directly
    setSaving(true);
    try {
      await updateProject({
        projectId: project._id,
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(slugChanged ? { slug: trimmedSlug } : {}),
      });
      setEditing(false);
      clearError();
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  async function handleEnabledToggle() {
    clearError();
    try {
      await updateProject({
        projectId: project._id,
        enabled: !(project.enabled ?? false),
      });
    } catch (err) {
      showError(err);
    }
  }

  async function handleDelete() {
    try {
      await removeProject({ projectId: project._id });
    } catch (err) {
      showError(err);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td>
          <input
            ref={nameInputRef}
            type="text"
            className="input input-sm w-full"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Project name"
          />
        </td>
        <td>
          <input
            type="text"
            className="input input-sm w-full font-mono text-xs"
            value={slugDraft}
            onChange={(e) => setSlugDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="project-slug"
          />
        </td>
        <td>
          <input
            type="text"
            className="input input-sm w-full font-mono text-xs"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/path/to/repo"
          />
        </td>
        <td>
          <ProjectStateBadge enabled={project.enabled} />
        </td>
        <td className="text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={saveEdit}
              disabled={saving}
            >
              {saving && (
                <span className="loading loading-spinner loading-xs" />
              )}
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelEdit}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          <ErrorBanner error={error} onDismiss={clearError} />
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="font-medium">{project.name}</td>
      <td>
        <code className="text-xs">{project.slug}</code>
      </td>
      <td>
        <code
          className="block max-w-xs truncate text-xs"
          title={project.path ?? ""}
        >
          {project.path || "—"}
        </code>
      </td>
      <td>
        <input
          type="checkbox"
          className="toggle toggle-success toggle-sm"
          checked={project.enabled ?? false}
          onChange={handleEnabledToggle}
          aria-label="Toggle project enabled"
        />
      </td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={startEdit}
            aria-label="Edit project"
            title="Edit project"
          >
            <FontAwesomeIcon icon={faPen} aria-hidden="true" />
          </button>
          {confirmDelete ? (
            <>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={handleDelete}
              >
                Confirm
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error"
              onClick={() => setConfirmDelete(true)}
              aria-label="Remove project"
              title="Remove project"
            >
              <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
            </button>
          )}
        </div>
        <ErrorBanner error={error} onDismiss={clearError} />
      </td>
    </tr>
  );
}
