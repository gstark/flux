import {
  type NavigateFn,
  useMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useRef } from "react";
import { api } from "$convex/_generated/api";
import { useProjectSlug } from "../hooks/useProjectId";
import { ProjectStateBadge } from "./ProjectStateBadge";

/**
 * Navigate to the equivalent route under a different project slug.
 * Detail routes (issue, session) drop to their parent list since
 * the entity ID won't exist cross-project.
 *
 * Each case uses a literal route string so TanStack Router validates
 * the route + params at compile time. If a route is renamed or removed,
 * this switch will produce a type error instead of a silent 404.
 */
function navigateToProject(
  navigate: NavigateFn,
  matches: Array<{ routeId: string }>,
  newSlug: string,
): void {
  // Walk matches from deepest to shallowest to find the most specific project route.
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!match) continue;
    switch (match.routeId) {
      case "/p/$projectSlug/issues/$issueId":
      case "/p/$projectSlug/issues":
        navigate({
          to: "/p/$projectSlug/issues",
          params: { projectSlug: newSlug },
        });
        return;
      case "/p/$projectSlug/sessions/$sessionId":
      case "/p/$projectSlug/sessions":
        navigate({
          to: "/p/$projectSlug/sessions",
          params: { projectSlug: newSlug },
        });
        return;
      case "/p/$projectSlug/activity":
        navigate({
          to: "/p/$projectSlug/activity",
          params: { projectSlug: newSlug },
        });
        return;
      case "/p/$projectSlug/settings":
        navigate({
          to: "/p/$projectSlug/settings",
          params: { projectSlug: newSlug },
        });
        return;
    }
  }
  // Fallback: navigate to issues list
  navigate({
    to: "/p/$projectSlug/issues",
    params: { projectSlug: newSlug },
  });
}

/**
 * Compact project switcher dropdown for the app shell navbar.
 * Shows current project name + state, lists all projects on click,
 * and preserves the current sub-route when switching.
 */
export function ProjectSwitcher() {
  const currentSlug = useProjectSlug();
  const projects = useQuery(api.projects.list);
  const matches = useMatches();
  const navigate = useNavigate();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const updateProject = useMutation(api.projects.update);

  if (!projects) return null;

  const current = projects.find((p) => p.slug === currentSlug);

  function switchTo(slug: string) {
    if (slug === currentSlug) return;

    navigateToProject(navigate, matches, slug);

    // Close the dropdown
    const details = detailsRef.current;
    if (details) details.open = false;
  }

  return (
    <details ref={detailsRef} className="dropdown">
      <summary className="btn btn-ghost btn-sm gap-2 font-semibold">
        {current?.name ?? currentSlug}
        {current && (
          <button
            type="button"
            title={current.enabled ? "Click to disable" : "Click to enable"}
            className="cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              updateProject({
                projectId: current._id,
                enabled: !current.enabled,
              });
            }}
          >
            <ProjectStateBadge enabled={current.enabled} />
          </button>
        )}
        <svg
          className="h-3 w-3 fill-current"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </summary>
      <ul className="dropdown-content menu z-10 mt-1 w-56 rounded-box bg-base-200 p-2 shadow-lg">
        {projects.map((project) => {
          const isActive = project.slug === currentSlug;
          return (
            <li key={project._id}>
              <button
                type="button"
                className={isActive ? "menu-active font-bold" : ""}
                onClick={() => switchTo(project.slug)}
              >
                <span className="flex-1 truncate">{project.name}</span>
                <ProjectStateBadge enabled={project.enabled} />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
