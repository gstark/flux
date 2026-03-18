import { formatTime, formatTimeShort } from "../lib/format";

/**
 * Compact timestamp display showing locale time with full datetime in a tooltip.
 * Designed for activity feeds — small, unobtrusive, and informative on hover.
 */
export function Timestamp({ ts }: { ts: number }) {
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={formatTime(ts)}
      className="shrink-0 cursor-default text-[10px] text-base-content/30 tabular-nums"
    >
      {formatTimeShort(ts)}
    </time>
  );
}
