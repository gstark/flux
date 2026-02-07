import { IssueStatus } from "$convex/schema";

const STATUS_CONFIG = {
  [IssueStatus.Open]: { label: "Open", className: "badge-info" },
  [IssueStatus.InProgress]: {
    label: "In Progress",
    className: "badge-warning",
  },
  [IssueStatus.Closed]: { label: "Closed", className: "badge-success" },
  [IssueStatus.Stuck]: { label: "Stuck", className: "badge-error" },
  [IssueStatus.Deferred]: { label: "Deferred", className: "badge-ghost" },
} as const;

type Status = (typeof IssueStatus)[keyof typeof IssueStatus];

export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`badge badge-sm ${config.className}`}>{config.label}</span>
  );
}
