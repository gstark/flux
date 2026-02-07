/**
 * Dismissable error alert banner. Renders nothing when error is null.
 */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;

  return (
    <div role="alert" className="alert alert-error text-sm">
      <span>{error}</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
