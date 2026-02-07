import { RouterProvider } from "@tanstack/react-router";
import type { Id } from "$convex/_generated/dataModel";
import { ProjectProvider } from "./lib/ProjectContext";
import { router } from "./lib/router";
import "./index.css";

export function App({ projectId }: { projectId: string }) {
  return (
    <ProjectProvider projectId={projectId as Id<"projects">}>
      <RouterProvider router={router} />
    </ProjectProvider>
  );
}
