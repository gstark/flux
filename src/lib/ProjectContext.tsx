import { createContext, useContext } from "react";
import type { Id } from "$convex/_generated/dataModel";

const ProjectContext = createContext<Id<"projects"> | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: Id<"projects">;
  children: React.ReactNode;
}) {
  return (
    <ProjectContext.Provider value={projectId}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectId(): Id<"projects"> {
  const id = useContext(ProjectContext);
  if (!id) throw new Error("useProjectId must be used within ProjectProvider");
  return id;
}
