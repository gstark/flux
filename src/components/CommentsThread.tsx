import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { CommentAuthorValue } from "$convex/schema";
import { CommentAuthor } from "$convex/schema";
import { useDismissableError } from "../hooks/useDismissableError";
import { formatRelativeTime } from "../lib/format";
import { modKey } from "../lib/platform";
import { ErrorBanner } from "./ErrorBanner";
import { FontAwesomeIcon, faPaperPlane, Icon } from "./Icon";
import { Markdown } from "./Markdown";

const AUTHOR_BADGE: Record<
  CommentAuthorValue,
  { label: string; className: string; icon: string }
> = {
  [CommentAuthor.User]: {
    label: "User",
    className: "badge-primary",
    icon: "fa-user",
  },
  [CommentAuthor.Agent]: {
    label: "Agent",
    className: "badge-secondary",
    icon: "fa-robot",
  },
  [CommentAuthor.Flux]: {
    label: "Flux",
    className: "badge-accent",
    icon: "fa-bolt",
  },
};

export function CommentsThread({ issueId }: { issueId: Id<"issues"> }) {
  const comments = useQuery(api.comments.list, { issueId });
  const createComment = useMutation(api.comments.create);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { error: submitError, showError, clearError } = useDismissableError();

  async function handleSubmit(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    clearError();
    try {
      await createComment({
        issueId,
        content: trimmed,
        author: CommentAuthor.User,
      });
      setDraft("");
    } catch (err) {
      showError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (comments === undefined) {
    return (
      <div className="flex justify-center p-4">
        <span className="loading loading-spinner loading-sm" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-medium text-base-content/60 text-sm">
        Comments{comments.length > 0 && ` (${comments.length})`}
      </h3>

      {comments.length === 0 ? (
        <p className="text-base-content/40 text-sm italic">No comments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {comments.map((comment) => {
            const badge = AUTHOR_BADGE[comment.author];
            return (
              <div key={comment._id} className="rounded-lg bg-base-200 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`badge badge-sm gap-1 ${badge.className}`}>
                    <Icon name={badge.icon} />
                    {badge.label}
                  </span>
                  <span className="text-base-content/40 text-xs">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                <div className="text-sm">
                  <Markdown content={comment.content} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ErrorBanner error={submitError} onDismiss={clearError} />

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          className="textarea min-h-20 w-full text-sm"
          placeholder="Add a comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-base-content/40 text-xs">
            {modKey}Enter to submit
          </span>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!draft.trim() || submitting}
          >
            {submitting ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <>
                <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" />
                Comment
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
