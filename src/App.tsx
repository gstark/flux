import { useQuery } from "convex/react";
import { api } from "$convex/_generated/api";
import { AppShell } from "./components/AppShell";
import "./index.css";

export function App() {
  const project = useQuery(api.projects.get, { slug: "flux" });

  if (project === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="alert alert-error max-w-md">
          <span>Project "flux" not found.</span>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <h2 className="font-semibold text-xl">{project.name}</h2>
    </AppShell>
  );
}
