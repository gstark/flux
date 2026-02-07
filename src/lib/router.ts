import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { IssueDetailPage } from "../pages/IssueDetailPage";
import { IssuesPage } from "../pages/IssuesPage";

const rootRoute = createRootRoute({
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  issuesRoute.addChildren([issueDetailRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
