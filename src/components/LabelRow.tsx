import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useDismissableError } from "../hooks/useDismissableError";
import { ColorSwatch } from "./ColorSwatch";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faPen, faTrash } from "./Icon";

export function LabelRow({
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
