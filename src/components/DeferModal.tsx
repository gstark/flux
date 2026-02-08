import { useMutation } from "convex/react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useDismissableError } from "../hooks/useDismissableError";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faCirclePause } from "./Icon";

interface DeferModalProps {
  /** Called after a successful defer so the parent can react (e.g. optimistic UI). */
  onDeferred?: () => void;
}

interface DeferModalHandle {
  open: (issueId: Id<"issues">) => void;
}

/**
 * Self-contained defer modal dialog.
 *
 * Usage:
 * ```tsx
 * const deferRef = useRef<DeferModalHandle>(null);
 * <DeferModal ref={deferRef} />
 * <button onClick={() => deferRef.current?.open(issueId)}>Defer</button>
 * ```
 */
export type { DeferModalHandle };

export function DeferModal({
  ref,
  onDeferred,
}: DeferModalProps & { ref: React.Ref<DeferModalHandle> }) {
  const deferIssue = useMutation(api.issues.defer);
  const [targetId, setTargetId] = useState<Id<"issues"> | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { error, showError, clearError } = useDismissableError();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (targetId) noteRef.current?.focus();
  }, [targetId]);

  function open(issueId: Id<"issues">) {
    setTargetId(issueId);
    setNote("");
    clearError();
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    setTargetId(null);
    setNote("");
    clearError();
  }

  async function handleDefer() {
    if (!targetId) return;
    setSubmitting(true);
    clearError();
    try {
      await deferIssue({
        issueId: targetId,
        note: note.trim() || "Deferred from UI",
      });
      close();
      onDeferred?.();
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  // Expose imperative open() to parent via ref
  useImperativeHandle(ref, () => ({ open }));

  return (
    <dialog ref={dialogRef} className="modal" onClose={close}>
      <div className="modal-box">
        <h3 className="mb-4 font-bold text-lg">Defer Issue</h3>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Reason (optional)</legend>
          <textarea
            ref={noteRef}
            className="textarea w-full"
            placeholder="Why is this being deferred?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </fieldset>
        <ErrorBanner error={error} onDismiss={clearError} />
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
            type="button"
            className="btn btn-warning"
            onClick={handleDefer}
            disabled={submitting}
          >
            {submitting ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
            )}
            Defer
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">close</button>
      </form>
    </dialog>
  );
}
