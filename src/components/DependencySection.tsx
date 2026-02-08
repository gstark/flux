import { Link, useRouteContext } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { IssueStatusValue } from "$convex/schema";
import { FontAwesomeIcon, faPlus, faXmark } from "./Icon";
import { StatusBadge } from "./StatusBadge";

type DepDirection = "blockers" | "blocks";

export function DependencySection({
  issueId,
  disabled,
  onError,
}: {
  issueId: Id<"issues">;
  disabled?: boolean;
  onError: (err: unknown) => void;
}) {
  const deps = useQuery(api.deps.listForIssue, { issueId });
  const addDep = useMutation(api.deps.add);
  const removeDep = useMutation(api.deps.remove);

  const [addingDirection, setAddingDirection] = useState<DepDirection | null>(
    null,
  );

  async function handleRemove(
    blockerId: Id<"issues">,
    blockedId: Id<"issues">,
  ) {
    try {
      await removeDep({ blockerId, blockedId });
    } catch (err) {
      onError(err);
    }
  }

  async function handleAdd(targetIssueId: Id<"issues">) {
    if (!addingDirection) return;
    try {
      if (addingDirection === "blockers") {
        // Adding a blocker: targetIssue blocks this issue
        await addDep({ blockerId: targetIssueId, blockedId: issueId });
      } else {
        // Adding to blocks: this issue blocks targetIssue
        await addDep({ blockerId: issueId, blockedId: targetIssueId });
      }
      setAddingDirection(null);
    } catch (err) {
      onError(err);
    }
  }

  if (deps === undefined) {
    return (
      <div>
        <h3 className="mb-2 font-medium text-base-content/60 text-sm">
          Dependencies
        </h3>
        <span className="loading loading-spinner loading-xs" />
      </div>
    );
  }

  // Collect IDs already linked so we can exclude them from the picker
  const linkedIds = new Set<string>([
    issueId,
    ...deps.blockers.map((d) => d.issueId),
    ...deps.blocks.map((d) => d.issueId),
  ]);

  return (
    <div>
      <h3 className="mb-2 font-medium text-base-content/60 text-sm">
        Dependencies
      </h3>
      <div className="flex flex-col gap-3">
        {/* Blocked by */}
        <DepList
          label="Blocked by"
          items={deps.blockers}
          direction="blockers"
          issueId={issueId}
          disabled={disabled}
          onRemove={handleRemove}
          onStartAdd={() => setAddingDirection("blockers")}
        />

        {/* Blocks */}
        <DepList
          label="Blocks"
          items={deps.blocks}
          direction="blocks"
          issueId={issueId}
          disabled={disabled}
          onRemove={handleRemove}
          onStartAdd={() => setAddingDirection("blocks")}
        />
      </div>

      {addingDirection && (
        <IssuePicker
          excludeIds={linkedIds}
          onSelect={handleAdd}
          onClose={() => setAddingDirection(null)}
          label={
            addingDirection === "blockers"
              ? "Add blocker..."
              : "Add blocked issue..."
          }
        />
      )}
    </div>
  );
}

type DepItem = {
  depId: Id<"dependencies">;
  issueId: Id<"issues">;
  shortId?: string;
  title?: string;
  status?: IssueStatusValue;
};

function DepList({
  label,
  items,
  direction,
  issueId,
  disabled,
  onRemove,
  onStartAdd,
}: {
  label: string;
  items: DepItem[];
  direction: DepDirection;
  issueId: Id<"issues">;
  disabled?: boolean;
  onRemove: (blockerId: Id<"issues">, blockedId: Id<"issues">) => void;
  onStartAdd: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{label}</span>
        {!disabled && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onStartAdd}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            Add
          </button>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-1">
          {items.map((item) => {
            const blockerId = direction === "blockers" ? item.issueId : issueId;
            const blockedId = direction === "blockers" ? issueId : item.issueId;
            return (
              <li key={item.depId} className="flex items-center gap-2 text-sm">
                <Link
                  to="/issues/$issueId"
                  params={{ issueId: item.issueId }}
                  className="link link-hover font-mono text-sm"
                >
                  {item.shortId ?? item.issueId}
                </Link>
                <span className="truncate text-base-content/80">
                  {item.title}
                </span>
                {item.status && <StatusBadge status={item.status} />}
                {!disabled && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => onRemove(blockerId, blockedId)}
                    title="Remove dependency"
                  >
                    <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-base-content/40 text-sm">None</p>
      )}
    </div>
  );
}

function IssuePicker({
  excludeIds,
  onSelect,
  onClose,
  label,
}: {
  excludeIds: Set<string>;
  onSelect: (issueId: Id<"issues">) => void;
  onClose: () => void;
  label: string;
}) {
  const { projectId } = useRouteContext({ from: "__root__" });
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const results = useQuery(
    api.issues.search,
    deferredSearch ? { projectId, query: deferredSearch } : "skip",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const container = containerRef.current;
      if (container && !container.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filtered = results?.filter((issue) => !excludeIds.has(issue._id)) ?? [];
  const isStale = deferredSearch !== search.trim();

  return (
    <div
      ref={containerRef}
      className="mt-2 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg"
    >
      <div className="mb-2 font-medium text-base-content/60 text-xs">
        {label}
      </div>
      <input
        ref={searchInputRef}
        type="text"
        className="input input-sm mb-2 w-full"
        placeholder="Search by title or ID (e.g. FLUX-42)..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {!deferredSearch ? (
        <p className="p-2 text-base-content/40 text-sm">
          Type to search for issues...
        </p>
      ) : results === undefined || isStale ? (
        <div className="p-2">
          <span className="loading loading-spinner loading-xs" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="p-2 text-base-content/60 text-sm">No matching issues.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {filtered.slice(0, 20).map((issue) => (
            <li key={issue._id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-base-200"
                onClick={() => onSelect(issue._id)}
              >
                <span className="font-mono text-xs">{issue.shortId}</span>
                <span className="truncate">{issue.title}</span>
                <StatusBadge status={issue.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
