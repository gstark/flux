import { Outlet, useMatch } from "@tanstack/react-router";
import { EpicsList } from "../components/EpicsList";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function EpicsPage() {
  const isDetailView = useMatch({
    from: "/p/$projectSlug/epics/$epicId",
    shouldThrow: false,
  });

  useDocumentTitle(isDetailView ? undefined : "Epics");

  if (isDetailView) {
    return <Outlet />;
  }

  return <EpicsList />;
}
