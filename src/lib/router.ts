import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { AppShell } from "../components/AppShell";
import { NotFound } from "../components/NotFound";
import { RouteError } from "../components/RouteError";
import { ActivityPage } from "../pages/ActivityPage";
import { IssueDetailPage } from "../pages/IssueDetailPage";
import { IssuesPage } from "../pages/IssuesPage";
import { LabelsPage } from "../pages/LabelsPage";
import { SessionDetailPage } from "../pages/SessionDetailPage";
import { SessionsPage } from "../pages/SessionsPage";
import { SettingsPage } from "../pages/SettingsPage";

export interface RouterContext {
  projectId: Id<"projects">;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/issues" });
  },
});

const issuesRoute = createRoute({
  getParentRoute: () => rootRoute,
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
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
  errorComponent: RouteError,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
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

const labelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/labels",
  component: LabelsPage,
  errorComponent: RouteError,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
  errorComponent: RouteError,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  issuesRoute.addChildren([issueDetailRoute]),
  activityRoute,
  sessionsRoute.addChildren([sessionDetailRoute]),
  labelsRoute,
  settingsRoute,
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({ routeTree, context });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
