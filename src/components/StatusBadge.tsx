import { IssueStatus } from "$convex/schema";
import { Icon } from "./Icon";

const STATUS_CONFIG = {
  [IssueStatus.Open]: {
    label: "Open",
    className: "badge-info",
    icon: "fa-circle",
  },
  [IssueStatus.InProgress]: {
    label: "In Progress",
    className: "badge-warning",
    icon: "fa-spinner fa-spin",
  },
  [IssueStatus.Closed]: {
    label: "Closed",
    className: "badge-success",
    icon: "fa-circle-check",
  },
  [IssueStatus.Stuck]: {
    label: "Stuck",
    className: "badge-error",
    icon: "fa-triangle-exclamation",
  },
  [IssueStatus.Deferred]: {
    label: "Deferred",
    className: "badge-ghost",
    icon: "fa-circle-pause",
  },
} as const;

type Status = (typeof IssueStatus)[keyof typeof IssueStatus];

export function StatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`badge badge-sm gap-1 ${config.className}`}>
      <Icon name={config.icon} />
      {config.label}
    </span>
  );
}
