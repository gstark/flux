import type { IssuePriorityValue } from "$convex/schema";
import { IssuePriority } from "$convex/schema";
import { Icon } from "./Icon";

const PRIORITY_CONFIG = {
  [IssuePriority.Critical]: {
    label: "Critical",
    className: "badge-outline badge-error",
    icon: "fa-fire",
  },
  [IssuePriority.High]: {
    label: "High",
    className: "badge-outline badge-warning",
    icon: "fa-arrow-up",
  },
  [IssuePriority.Medium]: {
    label: "Medium",
    className: "badge-outline badge-info",
    icon: "fa-minus",
  },
  [IssuePriority.Low]: {
    label: "Low",
    className: "badge-outline",
    icon: "fa-arrow-down",
  },
} as const;

export function PriorityBadge({ priority }: { priority: IssuePriorityValue }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span className={`badge badge-sm gap-1 ${config.className}`}>
      <Icon name={config.icon} />
      {config.label}
    </span>
  );
}
