import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { CommentAuthor } from "$convex/schema";

type CommentAuthorValue = (typeof CommentAuthor)[keyof typeof CommentAuthor];

const AUTHOR_BADGE: Record<
  CommentAuthorValue,
  { label: string; className: string }
> = {
  user: { label: "User", className: "badge-primary" },
  agent: { label: "Agent", className: "badge-secondary" },
  flux: { label: "Flux", className: "badge-accent" },
};

function formatRelativeTime(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CommentsThread({ issueId }: { issueId: Id<"issues"> }) {
  const comments = useQuery(api.comments.list, { issueId });
  const createComment = useMutation(api.comments.create);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await createComment({ issueId, content: trimmed, author: "user" });
      setDraft("");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to add comment",
      );
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
                  <span className={`badge badge-sm ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="text-base-content/40 text-xs">
                    {formatRelativeTime(comment.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
              </div>
            );
          })}
        </div>
      )}

      {submitError && (
        <div role="alert" className="alert alert-error text-sm">
          {submitError}
        </div>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <textarea
          className="textarea textarea-bordered min-h-20 w-full text-sm"
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
            Ctrl+Enter to submit
          </span>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!draft.trim() || submitting}
          >
            {submitting ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Comment"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
