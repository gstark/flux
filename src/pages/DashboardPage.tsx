import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "$convex/_generated/api";
import { ProjectDashboard } from "../components/ProjectDashboard";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function DashboardPage() {
  useDocumentTitle("Dashboard");
  const projects = useQuery(api.projects.list, {});
  const navigate = useNavigate();

  // Redirect to /projects when no projects exist so users can add their first one.
  useEffect(() => {
    if (projects !== undefined && projects.length === 0) {
      navigate({ to: "/projects", replace: true });
    }
  }, [projects, navigate]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="navbar w-full bg-base-300">
        <div className="flex-1 px-4">
          <Link to="/" className="font-bold text-lg hover:opacity-80">
            Flux
          </Link>
        </div>
      </div>
      <main className="grow p-6">
        <ProjectDashboard />
      </main>
    </div>
  );
}
