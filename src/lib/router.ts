import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { AppShell } from "../components/AppShell";
import { ActivityPage } from "../pages/ActivityPage";
import { IssueDetailPage } from "../pages/IssueDetailPage";
import { IssuesPage } from "../pages/IssuesPage";
import { SessionsPage } from "../pages/SessionsPage";

export interface RouterContext {
  projectId: Id<"projects">;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
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
});

const issueDetailRoute = createRoute({
  getParentRoute: () => issuesRoute,
  path: "$issueId",
  component: IssueDetailPage,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  component: ActivityPage,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsPage,
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => sessionsRoute,
  path: "$sessionId",
  // TODO: SessionDetailPage will be built in a follow-up issue
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  issuesRoute.addChildren([issueDetailRoute]),
  activityRoute,
  sessionsRoute.addChildren([sessionDetailRoute]),
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
