import { createContext, useContext } from "react";
import type { Id } from "$convex/_generated/dataModel";

const ProjectContext = createContext<{
  projectId: Id<"projects">;
  projectSlug: string;
} | null>(null);

export const ProjectProvider = ProjectContext.Provider;

export function useProjectId(): Id<"projects"> {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectId must be used within a ProjectProvider");
  }
  return ctx.projectId;
}

export function useProjectSlug(): string {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectSlug must be used within a ProjectProvider");
  }
  return ctx.projectSlug;
}
