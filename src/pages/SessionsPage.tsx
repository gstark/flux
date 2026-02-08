import { Outlet, useMatch } from "@tanstack/react-router";
import { SessionList } from "../components/SessionList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function SessionsPage() {
  const isDetailView = useMatch({
    from: "/p/$projectSlug/sessions/$sessionId",
    shouldThrow: false,
  });

  useDocumentTitle(isDetailView ? undefined : "Sessions");

  if (isDetailView) {
    return <Outlet />;
  }

  return <SessionList />;
}
