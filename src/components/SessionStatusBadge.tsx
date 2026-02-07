import { SessionStatus } from "$convex/schema";

const STATUS_CONFIG = {
  [SessionStatus.Running]: { label: "Running", className: "badge-warning" },
  [SessionStatus.Completed]: {
    label: "Completed",
    className: "badge-success",
  },
  [SessionStatus.Failed]: { label: "Failed", className: "badge-error" },
} as const;

type Status = (typeof SessionStatus)[keyof typeof SessionStatus];

export function SessionStatusBadge({ status }: { status: Status }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`badge badge-sm ${config.className}`}>{config.label}</span>
  );
}
