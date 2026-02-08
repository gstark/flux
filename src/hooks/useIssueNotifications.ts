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
          const n = notify(`${issue.shortId} is stuck`, {
            body: issue.title,
            tag: `flux-stuck-${issue._id}`,
          });
          if (n) {
            const issueId = issue._id;
            n.onclick = () => {
              window.focus();
              window.location.hash = "";
              window.location.pathname = `/issues/${issueId}`;
            };
          }
        } else if (curr === IssueStatus.Closed) {
          const n = notify(`${issue.shortId} completed`, {
            body: issue.title,
            tag: `flux-closed-${issue._id}`,
          });
          if (n) {
            const issueId = issue._id;
            n.onclick = () => {
              window.focus();
              window.location.hash = "";
              window.location.pathname = `/issues/${issueId}`;
            };
          }
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
  }, [issues, notify, ready]);
}
