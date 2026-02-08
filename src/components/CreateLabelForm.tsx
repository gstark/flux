import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useDismissableError } from "../hooks/useDismissableError";
import { ErrorBanner } from "./ErrorBanner";
import { DEFAULT_COLORS } from "./labelConstants";

export function CreateLabelForm({
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
