import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { IssueStatusValue } from "$convex/schema";
import { IssueStatus } from "$convex/schema";

/**
 * Watches all issues for status transitions to `stuck` or `closed`.
 * Fires a browser notification when a transition is detected.
 *
 * Uses a snapshot map of previous statuses so we only fire on actual
 * transitions — not on initial page load or re-renders.
 */
export function useIssueNotifications(
  projectId: Id<"projects">,
  notify: (
    title: string,
    options?: NotificationOptions,
  ) => Notification | undefined,
  ready: boolean,
  navigate: (opts: { to: string; params: Record<string, string> }) => void,
  projectSlug: string,
) {
  const issues = useQuery(api.issues.list, { projectId });

  // Map of issueId → previous status. Null means "first render, skip notifications".
  const prevMapRef = useRef<Map<Id<"issues">, IssueStatusValue> | null>(null);

  useEffect(() => {
    if (!issues) return;

    const prevMap = prevMapRef.current;

    // First load: snapshot current state without firing notifications
    if (!prevMap) {
      const initial = new Map<Id<"issues">, IssueStatusValue>();
      for (const issue of issues) {
        initial.set(issue._id, issue.status);
      }
      prevMapRef.current = initial;
      return;
    }

    // Detect transitions
    for (const issue of issues) {
      const prev = prevMap.get(issue._id);
      const curr = issue.status;

      // New issue or no previous status — snapshot without notifying
      if (prev === undefined) {
        prevMap.set(issue._id, curr);
        continue;
      }

      // Status changed
      if (prev !== curr) {
        prevMap.set(issue._id, curr);

        if (!ready) continue;

        if (curr === IssueStatus.Stuck) {
          fireNotification(
            notify,
            navigate,
            projectSlug,
            `${issue.shortId} is stuck`,
            issue,
          );
        } else if (curr === IssueStatus.Closed) {
          fireNotification(
            notify,
            navigate,
            projectSlug,
            `${issue.shortId} completed`,
            issue,
          );
        }
      }
    }

    // Clean up removed issues from the map
    const currentIds = new Set(issues.map((i) => i._id));
    for (const id of prevMap.keys()) {
      if (!currentIds.has(id)) {
        prevMap.delete(id);
      }
    }
  }, [issues, notify, ready, navigate, projectSlug]);
}

/** Fire a browser notification that navigates to the issue on click. */
function fireNotification(
  notify: (
    title: string,
    options?: NotificationOptions,
  ) => Notification | undefined,
  navigate: (opts: { to: string; params: Record<string, string> }) => void,
  projectSlug: string,
  title: string,
  issue: { _id: Id<"issues">; title: string; status: string },
) {
  const tag = `flux-${issue.status}-${issue._id}`;
  const n = notify(title, { body: issue.title, tag });
  if (n) {
    const issueId = issue._id;
    n.onclick = () => {
      window.focus();
      navigate({
        to: "/p/$projectSlug/issues/$issueId",
        params: { projectSlug, issueId },
      });
    };
  }
}
