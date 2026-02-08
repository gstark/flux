import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "$convex/_generated/api";
import type { IssuePriorityValue } from "$convex/schema";
import { IssuePriority } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { PRIORITY_OPTIONS } from "../lib/format";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faPlus } from "./Icon";

export interface CreateIssueModalHandle {
  open: () => void;
}

export function CreateIssueModal({
  ref,
  showButton = true,
}: {
  ref?: React.RefObject<CreateIssueModalHandle | null>;
  showButton?: boolean;
}) {
  const { projectId } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const createIssue = useMutation(api.issues.create);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<IssuePriorityValue>(
    IssuePriority.Medium,
  );
  const [titleError, setTitleError] = useState(false);
  const { error: submitError, showError, clearError } = useDismissableError();
  const [submitting, setSubmitting] = useState(false);

  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setIsOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    if (isOpen) titleInputRef.current?.focus();
  }, [isOpen]);

  function close() {
    dialogRef.current?.close();
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority(IssuePriority.Medium);
    setTitleError(false);
    clearError();
    setSubmitting(false);
    setIsOpen(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    clearError();

    let issueId: string;
    try {
      issueId = await createIssue({
        projectId,
        title: trimmedTitle,
        description: description.trim() || undefined,
        priority,
      });
    } catch (err) {
      showError(err);
      setSubmitting(false);
      return;
    }

    close();
    navigate({ to: "/issues/$issueId", params: { issueId } });
  }

  return (
    <>
      {showButton && (
        <button type="button" className="btn btn-primary btn-sm" onClick={open}>
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
          New Issue
        </button>
      )}

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
                ref={titleInputRef}
                type="text"
                className={`input w-full ${titleError ? "input-error" : ""}`}
                placeholder="Issue title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError(false);
                }}
              />
              {titleError && (
                <p className="mt-1 text-error text-sm">Title is required.</p>
              )}
            </fieldset>

            {/* Description */}
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

            {/* Priority */}
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Priority</legend>
              <select
                className="select w-full"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as IssuePriorityValue)
                }
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </fieldset>

            <ErrorBanner error={submitError} onDismiss={clearError} />

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
