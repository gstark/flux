import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 p-16">
      <h1 className="font-bold text-4xl text-base-content">404</h1>
      <p className="text-base-content/60 text-lg">Page not found</p>
      <Link to="/" className="btn btn-primary btn-sm">
        Back to Issues
      </Link>
    </div>
  );
}
