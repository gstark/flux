import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import { IssuePriority } from "$convex/schema";

type PriorityValue = (typeof IssuePriority)[keyof typeof IssuePriority];

const PRIORITY_OPTIONS: { value: PriorityValue; label: string }[] = [
  { value: IssuePriority.Critical, label: "Critical" },
  { value: IssuePriority.High, label: "High" },
  { value: IssuePriority.Medium, label: "Medium" },
  { value: IssuePriority.Low, label: "Low" },
];

export function CreateIssueModal() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const createIssue = useMutation(api.issues.create);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<PriorityValue>(IssuePriority.Medium);
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function open() {
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority(IssuePriority.Medium);
    setTitleError(false);
    setSubmitting(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    const issueId = await createIssue({
      projectId,
      title: trimmedTitle,
      description: description.trim() || undefined,
      priority,
    });

    close();
    navigate({ to: "/issues/$issueId", params: { issueId } });
  }

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={open}>
        <i className="fa-solid fa-plus" aria-hidden="true" />
        New Issue
      </button>

      <dialog ref={dialogRef} className="modal" onClose={resetForm}>
        <div className="modal-box">
          <h3 className="mb-4 font-bold text-lg">New Issue</h3>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Title */}
            <fieldset className="fieldset">
              <legend className="fieldset-legend">
                Title <span className="text-error">*</span>
              </legend>
              <input
                type="text"
                className={`input input-bordered w-full ${titleError ? "input-error" : ""}`}
                placeholder="Issue title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError(false);
                }}
                autoFocus
              />
              {titleError && (
                <p className="mt-1 text-error text-sm">Title is required.</p>
              )}
            </fieldset>

            {/* Description */}
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Description</legend>
              <textarea
                className="textarea textarea-bordered w-full"
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </fieldset>

            {/* Priority */}
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Priority</legend>
              <select
                className="select select-bordered w-full"
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityValue)}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </fieldset>

            {/* Actions */}
            <div className="modal-action">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={close}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting && (
                  <span className="loading loading-spinner loading-sm" />
                )}
                Create Issue
              </button>
            </div>
          </form>
        </div>

        <form method="dialog" className="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
    </>
  );
}
