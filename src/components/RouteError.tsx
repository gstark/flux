import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";

/** Extract a user-friendly message from Convex validation errors. */
function friendlyMessage(error: Error): string {
  if (error.message.includes("ArgumentValidationError")) {
    return "The requested resource was not found.";
  }
  return error.message;
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  function handleReset() {
    reset();
    router.invalidate();
  }

  const message = friendlyMessage(error);

  return (
    <div className="flex flex-col items-center gap-4 p-16">
      <h1 className="font-bold text-error text-xl">Something went wrong</h1>
      <p className="text-base-content/60">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleReset}
        >
          Try Again
        </button>
        <Link to="/issues" className="btn btn-ghost btn-sm">
          Back to Issues
        </Link>
      </div>
    </div>
  );
}
