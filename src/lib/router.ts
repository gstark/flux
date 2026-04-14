import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { ProjectLayout } from "../components/ProjectLayout";
import { RootLayout } from "../components/RootLayout";
import { RouteError } from "../components/RouteError";
import { ActivityPage } from "../pages/ActivityPage";
import { DashboardPage } from "../pages/DashboardPage";
import { EpicDetailPage } from "../pages/EpicDetailPage";
import { EpicsPage } from "../pages/EpicsPage";
import { IssueDetailPage } from "../pages/IssueDetailPage";
import { IssuesPage } from "../pages/IssuesPage";
import { PromptsPage } from "../pages/PromptsPage";
import { SessionDetailPage } from "../pages/SessionDetailPage";
import { SessionsPage } from "../pages/SessionsPage";
import { SettingsPage } from "../pages/SettingsPage";

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
  errorComponent: RouteError,
});

/** Redirect legacy /projects bookmarks to the dashboard. */
const projectsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});

/** Layout route: resolves projectSlug → projectId via Convex query. */
const projectLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$projectSlug",
  component: ProjectLayout,
  errorComponent: RouteError,
});

const issuesRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/issues",
  component: IssuesPage,
  errorComponent: RouteError,
});

const issueDetailRoute = createRoute({
  getParentRoute: () => issuesRoute,
  path: "$issueId",
  component: IssueDetailPage,
  errorComponent: RouteError,
});

const activityRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/activity",
  component: ActivityPage,
  errorComponent: RouteError,
});

const sessionsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/sessions",
  component: SessionsPage,
  errorComponent: RouteError,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: "$sessionId",
  component: SessionDetailPage,
  errorComponent: RouteError,
});

const epicsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/epics",
  component: EpicsPage,
  errorComponent: RouteError,
});

const epicDetailRoute = createRoute({
  getParentRoute: () => epicsRoute,
  path: "$epicId",
  component: EpicDetailPage,
  errorComponent: RouteError,
});

const settingsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/settings",
  component: SettingsPage,
  errorComponent: RouteError,
});

const promptsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/prompts",
  component: PromptsPage,
  errorComponent: RouteError,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  projectsRedirectRoute,
  projectLayoutRoute.addChildren([
    issuesRoute.addChildren([issueDetailRoute]),
    activityRoute,
    sessionsRoute.addChildren([sessionDetailRoute]),
    epicsRoute.addChildren([epicDetailRoute]),
    settingsRoute,
    promptsRoute,
  ]),
]);

export function createAppRouter() {
  return createRouter({ routeTree });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
