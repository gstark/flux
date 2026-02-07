import { SessionStatus } from "$convex/schema";
import { Icon } from "./Icon";

type Status = (typeof SessionStatus)[keyof typeof SessionStatus];

function statusConfig(status: Status): {
  label: string;
  className: string;
  icon: string;
} {
  switch (status) {
    case SessionStatus.Running:
      return {
        label: "Running",
        className: "badge-warning",
        icon: "fa-spinner fa-spin",
      };
    case SessionStatus.Completed:
      return {
        label: "Completed",
        className: "badge-success",
        icon: "fa-circle-check",
      };
    case SessionStatus.Failed:
      return {
        label: "Failed",
        className: "badge-error",
        icon: "fa-circle-xmark",
      };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled session status: ${_exhaustive}`);
    }
  }
}

export function SessionStatusBadge({ status }: { status: Status }) {
  const config = statusConfig(status);
  return (
    <span className={`badge badge-sm gap-1 ${config.className}`}>
      <Icon name={config.icon} />
      {config.label}
    </span>
  );
}
