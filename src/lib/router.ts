import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { NotFound } from "../components/NotFound";
import { ProjectLayout } from "../components/ProjectLayout";
import { RootLayout } from "../components/RootLayout";
import { RouteError } from "../components/RouteError";
import { ActivityPage } from "../pages/ActivityPage";
import { IssueDetailPage } from "../pages/IssueDetailPage";
import { IssuesPage } from "../pages/IssuesPage";
import { LabelsPage } from "../pages/LabelsPage";
import { SessionDetailPage } from "../pages/SessionDetailPage";
import { SessionsPage } from "../pages/SessionsPage";
import { SettingsPage } from "../pages/SettingsPage";

export interface RouterContext {
  /** Default project slug used for the root `/` redirect. */
  defaultSlug: string;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    throw redirect({
      to: "/p/$projectSlug/issues",
      params: { projectSlug: context.defaultSlug },
    });
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

const labelsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/labels",
  component: LabelsPage,
  errorComponent: RouteError,
});

const settingsRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: "/settings",
  component: SettingsPage,
  errorComponent: RouteError,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectLayoutRoute.addChildren([
    issuesRoute.addChildren([issueDetailRoute]),
    activityRoute,
    sessionsRoute.addChildren([sessionDetailRoute]),
    labelsRoute,
    settingsRoute,
  ]),
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
