import { useState } from "react";
import { FontAwesomeIcon, faCirclePause, faCirclePlay } from "./Icon";

interface IssueDeferFormProps {
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDefer: (note: string) => Promise<void>;
}

/** Trigger button shown in the actions toolbar. */
export function IssueDeferButton({
  busy,
  expanded,
  onToggle,
}: Pick<IssueDeferFormProps, "busy" | "expanded" | "onToggle">) {
  return (
    <button
      type="button"
      className={`btn btn-outline btn-warning btn-sm ${expanded ? "btn-active" : ""}`}
      onClick={onToggle}
      disabled={busy}
    >
      <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
      Defer Issue
    </button>
  );
}

/** Undefer button — shown when the issue is already deferred. */
export function IssueUndeferButton({
  busy,
  undeferring,
  onUndefer,
}: {
  busy: boolean;
  undeferring: boolean;
  onUndefer: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-outline btn-info btn-sm"
      onClick={onUndefer}
      disabled={busy}
    >
      {undeferring ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <FontAwesomeIcon icon={faCirclePlay} aria-hidden="true" />
      )}
      Undefer Issue
    </button>
  );
}

/** Expandable form panel rendered below the toolbar. */
export function IssueDeferFormPanel({
  busy,
  deferring,
  onDefer,
  onCancel,
}: {
  busy: boolean;
  deferring: boolean;
  onDefer: IssueDeferFormProps["onDefer"];
  onCancel: () => void;
}) {
  const [deferNote, setDeferNote] = useState("");

  async function handleDeferSubmit() {
    try {
      await onDefer(deferNote.trim() || "Deferred from UI");
      setDeferNote("");
      onCancel();
    } catch {
      // Parent handles error display — keep form open so user doesn't lose input
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-base-200 p-4">
      <h3 className="font-medium">Defer Issue</h3>
      <textarea
        className="textarea"
        placeholder="Reason for deferring (optional)"
        value={deferNote}
        onChange={(e) => setDeferNote(e.target.value)}
        rows={2}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-warning btn-sm"
          onClick={handleDeferSubmit}
          disabled={busy}
        >
          {deferring ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <FontAwesomeIcon icon={faCirclePause} aria-hidden="true" />
          )}
          Confirm Defer
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
