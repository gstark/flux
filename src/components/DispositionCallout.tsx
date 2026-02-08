import { Disposition, type DispositionValue } from "$convex/schema";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

function dispositionLabel(disposition: DispositionValue): {
  label: string;
  className: string;
  icon: string;
} {
  switch (disposition) {
    case Disposition.Done:
      return {
        label: "Done",
        className: "badge-success",
        icon: "fa-circle-check",
      };
    case Disposition.Noop:
      return {
        label: "No-op",
        className: "badge-info",
        icon: "fa-circle-minus",
      };
    case Disposition.Fault:
      return {
        label: "Fault",
        className: "badge-error",
        icon: "fa-circle-exclamation",
      };
    default: {
      const _exhaustive: never = disposition;
      throw new Error(`Unhandled disposition: ${_exhaustive}`);
    }
  }
}

interface DispositionCalloutProps {
  disposition: DispositionValue;
  note?: string;
}

export function DispositionCallout({
  disposition,
  note,
}: DispositionCalloutProps) {
  const dispo = dispositionLabel(disposition);

  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border p-4 ${
        disposition === Disposition.Fault
          ? "border-error/30 bg-error/10"
          : disposition === Disposition.Done
            ? "border-success/30 bg-success/10"
            : "border-info/30 bg-info/10"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">Disposition:</span>
        <span className={`badge badge-sm gap-1 ${dispo.className}`}>
          <Icon name={dispo.icon} />
          {dispo.label}
        </span>
      </div>
      {note && (
        <div className="text-sm">
          <Markdown content={note} />
        </div>
      )}
    </div>
  );
}
