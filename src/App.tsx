import { RouterProvider } from "@tanstack/react-router";
import { useMemo } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { createAppRouter } from "./lib/router";
import "./index.css";

interface AppProps {
  defaultSlug: string;
}

export function App({ defaultSlug }: AppProps) {
  const router = useMemo(() => createAppRouter({ defaultSlug }), [defaultSlug]);

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
