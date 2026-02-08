import { useQuery } from "convex/react";
import type React from "react";
import { useDeferredValue, useState } from "react";
import { api } from "$convex/_generated/api";
import type { Doc } from "$convex/_generated/dataModel";
import { useProjectId } from "../hooks/useProjectId";

/** Return type of useIssueSearch — everything consumers need. */
export interface IssueSearchState {
  search: string;
  setSearch: (value: string) => void;
  /** Debounced, trimmed query string. Empty when user hasn't typed yet. */
  deferredSearch: string;
  /** Raw results from the API (undefined while loading). */
  results: Doc<"issues">[] | undefined;
  /** True while the deferred value hasn't caught up yet. */
  isStale: boolean;
}

/**
 * Encapsulates the search-input state, deferred debouncing,
 * and the `api.issues.search` query subscription.
 *
 * @param enabled  When false the query is skipped entirely (e.g. dialog not open).
 */
export function useIssueSearch({ enabled = true } = {}): IssueSearchState {
  const projectId = useProjectId();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const results = useQuery(
    api.issues.search,
    enabled && deferredSearch ? { projectId, query: deferredSearch } : "skip",
  );

  const isStale = deferredSearch !== search.trim();

  return { search, setSearch, deferredSearch, results, isStale };
}

/**
 * Shared three-state search results renderer:
 *   1. Empty prompt (user hasn't typed)
 *   2. Loading spinner
 *   3. "No matching issues" or the result list via `renderItem`
 */
export function IssueSearchResults({
  items,
  deferredSearch,
  isLoading,
  emptyPrompt = "Type to search by title or ID (e.g. FLUX-42)",
  compact = false,
  className,
  renderItem,
}: {
  items: Doc<"issues">[];
  deferredSearch: string;
  isLoading: boolean;
  emptyPrompt?: string;
  /** When true, uses compact left-aligned styling suitable for small dropdowns. */
  compact?: boolean;
  className?: string;
  renderItem: (issue: Doc<"issues">, index: number) => React.ReactNode;
}) {
  const stateClassName = compact ? "p-2 text-sm" : "py-6 text-center text-sm";

  if (!deferredSearch) {
    return (
      <p className={`${stateClassName} text-base-content/40`}>{emptyPrompt}</p>
    );
  }

  if (isLoading) {
    return compact ? (
      <div className="p-2">
        <span className="loading loading-spinner loading-xs" />
      </div>
    ) : (
      <div className="flex justify-center py-6">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className={`${stateClassName} text-base-content/60`}>
        No matching issues.
      </p>
    );
  }

  return (
    <ul className={className ?? "flex flex-col gap-0.5"}>
      {items.map((issue, i) => (
        <li key={issue._id}>{renderItem(issue, i)}</li>
      ))}
    </ul>
  );
}
