import { useEffect, useRef, useState } from "react";
import { useDismissableError } from "../hooks/useDismissableError";
import { ErrorBanner } from "./ErrorBanner";

export function AddProjectForm({ onCreated }: { onCreated: () => void }) {
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { error, showError, clearError } = useDismissableError();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;

    setSubmitting(true);
    clearError();

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      setPath("");
      onCreated();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <fieldset className="fieldset">
        <legend className="fieldset-legend">
          Project Root Path <span className="text-error">*</span>
        </legend>
        <input
          ref={inputRef}
          type="text"
          className="input w-full font-mono text-sm"
          placeholder="/path/to/your/git/repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <p className="mt-1 text-base-content/50 text-xs">
          Must be an existing git repository.
        </p>
      </fieldset>

      <ErrorBanner error={error} onDismiss={clearError} />

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={submitting || !path.trim()}
        >
          {submitting && (
            <span className="loading loading-spinner loading-sm" />
          )}
          Add Project
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCreated}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
