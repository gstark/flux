import { useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { useDismiss } from "../hooks/useDismiss";
import { useProjectId } from "../hooks/useProjectId";
import { FontAwesomeIcon, faTag } from "./Icon";
import { LabelBadge } from "./LabelBadge";

export function LabelPicker({
  selectedIds,
  onChange,
  disabled,
}: {
  selectedIds: Id<"labels">[];
  onChange: (ids: Id<"labels">[]) => void;
  disabled?: boolean;
}) {
  const projectId = useProjectId();
  const allLabels = useQuery(api.labels.list, { projectId });
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, close, open);

  if (allLabels === undefined) {
    return <span className="loading loading-spinner loading-xs" />;
  }

  const selectedSet = new Set(selectedIds);

  function toggle(labelId: Id<"labels">) {
    if (selectedSet.has(labelId)) {
      onChange(selectedIds.filter((id) => id !== labelId));
    } else {
      onChange([...selectedIds, labelId]);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={faTag} aria-hidden="true" />
        Edit
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg">
          {allLabels.length === 0 ? (
            <p className="p-2 text-base-content/60 text-sm">
              No labels. Create labels first.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {allLabels.map((label) => {
                const checked = selectedSet.has(label._id);
                return (
                  <li key={label._id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-200 ${checked ? "bg-base-200" : ""}`}
                      onClick={() => toggle(label._id)}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={checked}
                        readOnly
                        tabIndex={-1}
                      />
                      <LabelBadge name={label.name} color={label.color} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
