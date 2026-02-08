import { useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useDismissableError } from "../hooks/useDismissableError";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faPen, faPlus, faTrash } from "./Icon";

const DEFAULT_COLORS: [string, ...string[]] = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#22c55e", // green
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray
  "#14b8a6", // teal
];

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border border-base-content/20"
      style={{ backgroundColor: color }}
    />
  );
}

function CreateLabelForm({
  projectId,
  onCreated,
}: {
  projectId: Id<"projects">;
  onCreated: () => void;
}) {
  const createLabel = useMutation(api.labels.create);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const { error, showError, clearError } = useDismissableError();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    clearError();
    try {
      await createLabel({ projectId, name: trimmed, color });
      setName("");
      setColor(DEFAULT_COLORS[0]);
      onCreated();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <fieldset className="fieldset">
        <legend className="fieldset-legend">
          Name <span className="text-error">*</span>
        </legend>
        <input
          ref={nameInputRef}
          type="text"
          className="input input-sm"
          placeholder="Label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </fieldset>

      <fieldset className="fieldset">
        <legend className="fieldset-legend">Color</legend>
        <div className="flex items-center gap-1">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
          <input
            type="color"
            className="ml-1 h-6 w-6 cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Custom color"
          />
        </div>
      </fieldset>

      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={submitting || !name.trim()}
      >
        {submitting && <span className="loading loading-spinner loading-sm" />}
        Add Label
      </button>

      <ErrorBanner error={error} onDismiss={clearError} />
    </form>
  );
}

function LabelRow({
  label,
}: {
  label: {
    _id: Id<"labels">;
    name: string;
    color: string;
  };
}) {
  const updateLabel = useMutation(api.labels.update);
  const removeLabel = useMutation(api.labels.remove);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(label.name);
  const [colorDraft, setColorDraft] = useState(label.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { error, showError, clearError } = useDismissableError();

  const nameInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (editing) nameInputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setNameDraft(label.name);
    setColorDraft(label.color);
    setEditing(true);
    clearError();
  }

  async function saveEdit() {
    if (savingRef.current) return;

    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }

    const nameChanged = trimmed !== label.name;
    const colorChanged = colorDraft !== label.color;
    if (!nameChanged && !colorChanged) {
      setEditing(false);
      return;
    }

    savingRef.current = true;
    try {
      await updateLabel({
        labelId: label._id,
        ...(nameChanged ? { name: trimmed } : {}),
        ...(colorChanged ? { color: colorDraft } : {}),
      });
      setEditing(false);
      clearError();
    } catch (err) {
      showError(err);
    } finally {
      savingRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }

  async function handleDelete() {
    try {
      await removeLabel({ labelId: label._id });
    } catch (err) {
      showError(err);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-6 w-6 cursor-pointer"
              value={colorDraft}
              onChange={(e) => setColorDraft(e.target.value)}
              title="Edit color"
            />
            <input
              ref={nameInputRef}
              type="text"
              className="input input-sm"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveEdit}
            />
          </div>
          <ErrorBanner error={error} onDismiss={clearError} />
        </td>
        <td className="text-right">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <div className="flex items-center gap-2">
          <ColorSwatch color={label.color} />
          <span>{label.name}</span>
        </div>
        <ErrorBanner error={error} onDismiss={clearError} />
      </td>
      <td className="text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={startEdit}
            title="Edit label"
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
              title="Delete label"
            >
              <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function LabelsList() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const labels = useQuery(api.labels.list, { projectId });
  const [showCreate, setShowCreate] = useState(false);

  if (labels === undefined) {
    return (
      <div className="flex justify-center p-8">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl">Labels</h1>
        {!showCreate && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            New Label
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-lg border border-base-300 bg-base-200 p-4">
          <CreateLabelForm
            projectId={projectId}
            onCreated={() => setShowCreate(false)}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2"
            onClick={() => setShowCreate(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {labels.length === 0 ? (
        <p className="text-base-content/60">No labels yet. Create one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-zebra table">
            <thead>
              <tr>
                <th>Label</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {labels.map((label) => (
                <LabelRow key={label._id} label={label} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
