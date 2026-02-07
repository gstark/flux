import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Id } from "$convex/_generated/dataModel";
import { createAppRouter } from "./lib/router";
import "./index.css";

/**
 * App fetches projectId from /api/config directly rather than receiving it
 * as a prop from the entry point. Bun's dev server HMR bundler has a bug
 * where it tree-shakes JSX props passed to components in the HTML entry
 * point script, so we fetch the config here instead.
 */
export function App() {
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => {
        if (!res.ok) throw new Error(`/api/config failed: ${res.status}`);
        return res.json();
      })
      .then((data: { projectId: string }) => {
        setProjectId(data.projectId as Id<"projects">);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const router = useMemo(
    () => (projectId ? createAppRouter({ projectId }) : null),
    [projectId],
  );

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <pre className="max-w-lg whitespace-pre-wrap text-error">
          Failed to load config: {error}
        </pre>
      </div>
    );
  }

  if (!router) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return <RouterProvider router={router} />;
}
