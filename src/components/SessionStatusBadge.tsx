import type { SessionStatusValue } from "$convex/schema";
import { SessionStatus } from "$convex/schema";
import { Icon } from "./Icon";

function statusConfig(status: SessionStatusValue): {
  label: string;
  className: string;
  icon: string;
} {
  switch (status) {
    case SessionStatus.Running:
      return {
        label: "Running",
        className: "badge-soft badge-warning",
        icon: "fa-spinner fa-spin",
      };
    case SessionStatus.Completed:
      return {
        label: "Completed",
        className: "badge-soft badge-success",
        icon: "fa-circle-check",
      };
    case SessionStatus.Failed:
      return {
        label: "Failed",
        className: "badge-soft badge-error",
        icon: "fa-circle-xmark",
      };
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled session status: ${_exhaustive}`);
    }
  }
}

export function SessionStatusBadge({
  status,
  title,
}: {
  status: SessionStatusValue;
  title?: string;
}) {
  const config = statusConfig(status);
  return (
    <span
      title={title}
      className={`badge badge-sm gap-1 whitespace-nowrap ${config.className}`}
    >
      <Icon name={config.icon} />
      {config.label}
    </span>
  );
}
