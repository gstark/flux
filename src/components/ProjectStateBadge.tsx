import { Icon } from "./Icon";

export function ProjectStateBadge({
  enabled,
}: {
  enabled: boolean | undefined;
}) {
  const isEnabled = enabled ?? false;
  const label = isEnabled ? "Enabled" : "Disabled";
  const className = isEnabled ? "badge-soft badge-success" : "badge-ghost";
  const icon = isEnabled ? "fa-circle-play" : "fa-stop";

  return (
    <span className={`badge badge-sm gap-1 ${className}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}
