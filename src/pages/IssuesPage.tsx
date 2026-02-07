import { Outlet, useMatch } from "@tanstack/react-router";
import { IssueList } from "../components/IssueList";

export function IssuesPage() {
  const isDetailView = useMatch({
    from: "/issues/$issueId",
    shouldThrow: false,
  });

  if (isDetailView) {
    return <Outlet />;
  }

  return <IssueList />;
}
