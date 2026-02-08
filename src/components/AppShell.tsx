import { Outlet, useRouteContext } from "@tanstack/react-router";
import { useIssueNotifications } from "../hooks/useIssueNotifications";
import {
  NotificationProvider,
  useNotifications,
} from "../hooks/useNotifications";
import { SSEProvider } from "../hooks/useSSE";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

/** Watches issue status transitions and fires browser notifications. */
function IssueNotificationWatcher() {
  const { projectId } = useRouteContext({ from: "__root__" });
  const { notify, ready } = useNotifications();
  useIssueNotifications(projectId, notify, ready);
  return null;
}

export function AppShell() {
  return (
    <NotificationProvider>
      <SSEProvider>
        <IssueNotificationWatcher />
        <div className="drawer lg:drawer-open">
          <input id="app-drawer" type="checkbox" className="drawer-toggle" />
          <div className="drawer-content flex flex-col">
            <Navbar />
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
      </SSEProvider>
    </NotificationProvider>
  );
}
