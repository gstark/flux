import { Link } from "@tanstack/react-router";
import { ProjectDashboard } from "../components/ProjectDashboard";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function DashboardPage() {
  useDocumentTitle("Dashboard");

  const commitSha = __GIT_COMMIT_SHA__;
  const shortCommitSha = commitSha.slice(0, 7);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="navbar w-full bg-base-300">
        <div className="flex-1 px-4">
          <Link to="/" className="font-bold text-lg hover:opacity-80">
            Flux
          </Link>
        </div>
        <div
          className="px-4 font-mono text-base-content/60 text-xs"
          title={commitSha}
        >
          {shortCommitSha}
        </div>
      </div>
      <main className="grow p-6">
        <ProjectDashboard />
      </main>
    </div>
  );
}
