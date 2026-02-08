import { Outlet } from "@tanstack/react-router";

/** Minimal root layout — project-scoped shell lives in ProjectLayout. */
export function RootLayout() {
  return <Outlet />;
}
