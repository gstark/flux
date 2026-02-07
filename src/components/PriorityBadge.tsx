import { IssuePriority } from "$convex/schema";

const PRIORITY_CONFIG = {
  [IssuePriority.Critical]: {
    label: "Critical",
    className: "badge-error",
  },
  [IssuePriority.High]: { label: "High", className: "badge-warning" },
  [IssuePriority.Medium]: { label: "Medium", className: "badge-info" },
  [IssuePriority.Low]: { label: "Low", className: "badge-ghost" },
} as const;

type Priority = (typeof IssuePriority)[keyof typeof IssuePriority];

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <span className={`badge badge-sm badge-outline ${config.className}`}>
      {config.label}
    </span>
  );
}
