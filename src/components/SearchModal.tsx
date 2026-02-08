import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useProjectSlug } from "../hooks/useProjectId";
import { FontAwesomeIcon, faMagnifyingGlass } from "./Icon";
import { IssueSearchResults, useIssueSearch } from "./IssueSearchResults";
import { PriorityBadge } from "./PriorityBadge";
import { StatusBadge } from "./StatusBadge";

export interface SearchModalHandle {
  open: () => void;
}

export function SearchModal({
  ref,
}: {
  ref: React.RefObject<SearchModalHandle | null>;
}) {
  const navigate = useNavigate();
  const projectSlug = useProjectSlug();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { search, setSearch, deferredSearch, results, isStale } =
    useIssueSearch({ enabled: isOpen });

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setIsOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({ open }), [open]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  function close() {
    dialogRef.current?.close();
  }

  function resetState() {
    setSearch("");
    setSelectedIndex(0);
    setIsOpen(false);
  }

  function navigateToIssue(issueId: string) {
    close();
    navigate({
      to: "/p/$projectSlug/issues/$issueId",
      params: { projectSlug, issueId },
    });
  }

  const items = results ?? [];

  // Clamp selectedIndex when results shrink
  useEffect(() => {
    if (items.length > 0 && selectedIndex >= items.length) {
      setSelectedIndex(items.length - 1);
    }
  }, [items.length, selectedIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = items[selectedIndex];
      if (selected) navigateToIssue(selected._id);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal modal-top"
      onClose={resetState}
      onKeyDown={handleKeyDown}
    >
      <div className="modal-box mt-[10vh] max-w-lg">
        {/* Search input */}
        <div className="flex items-center gap-3 border-base-300 border-b pb-3">
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className="text-base-content/40"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            className="grow bg-transparent text-lg outline-none placeholder:text-base-content/40"
            placeholder="Search issues..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="kbd kbd-sm">Esc</kbd>
        </div>

        {/* Results */}
        <div className="mt-3 max-h-80 overflow-y-auto">
          <IssueSearchResults
            items={items}
            deferredSearch={deferredSearch}
            isLoading={results === undefined || isStale}
            renderItem={(issue, i) => (
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  i === selectedIndex
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-base-200"
                }`}
                onClick={() => navigateToIssue(issue._id)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="shrink-0 font-mono text-xs opacity-60">
                  {issue.shortId}
                </span>
                <span className="min-w-0 grow truncate">{issue.title}</span>
                <StatusBadge status={issue.status} />
                <PriorityBadge priority={issue.priority} />
              </button>
            )}
          />
        </div>
      </div>

      <form method="dialog" className="modal-backdrop">
        <button type="submit">close</button>
      </form>
    </dialog>
  );
}
