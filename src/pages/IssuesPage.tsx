import { Outlet, useMatch } from "@tanstack/react-router";
import { IssueList } from "../components/IssueList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function IssuesPage() {
  const isDetailView = useMatch({
    from: "/p/$projectSlug/issues/$issueId",
    shouldThrow: false,
  });

  useDocumentTitle(isDetailView ? undefined : "Issues");

  if (isDetailView) {
    return <Outlet />;
  }

  return <IssueList />;
}
