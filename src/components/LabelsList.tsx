import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import { useProjectId } from "../hooks/useProjectId";
import { CreateLabelForm } from "./CreateLabelForm";
import { FontAwesomeIcon, faPlus } from "./Icon";
import { LabelRow } from "./LabelRow";

export function LabelsList() {
  const projectId = useProjectId();
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
    <div className="flex flex-col gap-4 p-6">
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
