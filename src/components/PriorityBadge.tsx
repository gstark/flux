import type { IssuePriorityValue } from "$convex/schema";
import { IssuePriority } from "$convex/schema";
import { Icon } from "./Icon";

const PRIORITY_CONFIG = {
  [IssuePriority.Critical]: {
    label: "Critical",
    className: "badge-error",
    icon: "fa-fire",
  },
  [IssuePriority.High]: {
    label: "High",
    className: "badge-warning",
    icon: "fa-arrow-up",
  },
  [IssuePriority.Medium]: {
    label: "Medium",
    className: "badge-info",
    icon: "fa-minus",
  },
  [IssuePriority.Low]: {
    label: "Low",
    className: "badge-ghost",
    icon: "fa-arrow-down",
  },
} as const;

export function PriorityBadge({ priority }: { priority: IssuePriorityValue }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span className={`badge badge-sm badge-outline gap-1 ${config.className}`}>
      <Icon name={config.icon} />
      {config.label}
    </span>
  );
}
