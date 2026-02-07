import { Outlet, useMatch } from "@tanstack/react-router";
import { SessionList } from "../components/SessionList";

export function SessionsPage() {
  const isDetailView = useMatch({
    from: "/sessions/$sessionId",
    shouldThrow: false,
  });

  if (isDetailView) {
    return <Outlet />;
  }

  return <SessionList />;
}
