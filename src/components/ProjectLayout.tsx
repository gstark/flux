import { Outlet, useParams, useRouter } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo, useRef } from "react";
import { api } from "$convex/_generated/api";
import { useGlobalShortcuts } from "../hooks/useGlobalShortcuts";
import { useIssueNotifications } from "../hooks/useIssueNotifications";
import {
  NotificationProvider,
  useNotifications,
} from "../hooks/useNotifications";
import {
  ProjectProvider,
  useProjectId,
  useProjectSlug,
} from "../hooks/useProjectId";
import { SSEProvider } from "../hooks/useSSE";
import {
  CreateIssueModal,
  type CreateIssueModalHandle,
} from "./CreateIssueModal";
import { Navbar } from "./Navbar";
import { SearchModal, type SearchModalHandle } from "./SearchModal";
import { Sidebar } from "./Sidebar";

/** Watches issue status transitions and fires browser notifications. */
function IssueNotificationWatcher() {
  const projectId = useProjectId();
  const projectSlug = useProjectSlug();
  const { notify, ready } = useNotifications();
  const { navigate } = useRouter();
  useIssueNotifications(projectId, notify, ready, navigate, projectSlug);
  return null;
}

/** Inner shell — rendered once ProjectProvider is active. */
function ProjectShell() {
  const projectId = useProjectId();
  const searchRef = useRef<SearchModalHandle>(null);
  const createRef = useRef<CreateIssueModalHandle>(null);

  const shortcuts = useMemo(
    () => ({
      onSearch: () => searchRef.current?.open(),
      onCreateIssue: () => createRef.current?.open(),
    }),
    [],
  );
  useGlobalShortcuts(shortcuts);

  return (
    <NotificationProvider>
      <SSEProvider projectId={projectId}>
        <IssueNotificationWatcher />
        <div className="drawer lg:drawer-open">
          <input id="app-drawer" type="checkbox" className="drawer-toggle" />
          <div className="drawer-content flex flex-col">
            <Navbar
              onSearchClick={shortcuts.onSearch}
              onCreateClick={shortcuts.onCreateIssue}
            />
            <main className="grow p-6">
              <Outlet />
            </main>
          </div>
          <div className="drawer-side">
            <label
              htmlFor="app-drawer"
              aria-label="close sidebar"
              className="drawer-overlay"
            />
            <Sidebar />
          </div>
        </div>

        <SearchModal ref={searchRef} />
        <CreateIssueModal ref={createRef} />
      </SSEProvider>
    </NotificationProvider>
  );
}

export function ProjectLayout() {
  const { projectSlug } = useParams({ from: "/p/$projectSlug" });
  const project = useQuery(api.projects.get, { slug: projectSlug });

  if (project === undefined) {
    return (
      <div className="flex justify-center p-16">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-16">
        <h1 className="font-bold text-4xl text-base-content">404</h1>
        <p className="text-base-content/60 text-lg">
          Project <code className="font-mono">"{projectSlug}"</code> not found
        </p>
      </div>
    );
  }

  return (
    <ProjectProvider value={{ projectId: project._id, projectSlug }}>
      <ProjectShell />
    </ProjectProvider>
  );
}
