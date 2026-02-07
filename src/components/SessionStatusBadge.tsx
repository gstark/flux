import { SessionStatus } from "$convex/schema";

type Status = (typeof SessionStatus)[keyof typeof SessionStatus];

function statusConfig(status: Status): { label: string; className: string } {
  switch (status) {
    case SessionStatus.Running:
      return { label: "Running", className: "badge-warning" };
    case SessionStatus.Completed:
      return { label: "Completed", className: "badge-success" };
    case SessionStatus.Failed:
      return { label: "Failed", className: "badge-error" };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled session status: ${_exhaustive}`);
    }
  }
}

export function SessionStatusBadge({ status }: { status: Status }) {
  const config = statusConfig(status);
  return (
    <span className={`badge badge-sm ${config.className}`}>{config.label}</span>
  );
}
