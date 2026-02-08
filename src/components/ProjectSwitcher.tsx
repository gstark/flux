import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useRef } from "react";
import { api } from "$convex/_generated/api";
import { useProjectSlug } from "../hooks/useProjectId";
import { ProjectStateBadge } from "./ProjectStateBadge";

/**
 * Compact project switcher dropdown for the app shell navbar.
 * Shows current project name + state, lists all projects on click,
 * and preserves the current sub-route when switching.
 */
export function ProjectSwitcher() {
  const currentSlug = useProjectSlug();
  const projects = useQuery(api.projects.list);
  const { state: routerState } = useRouter();
  const navigate = useNavigate();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  if (!projects) return null;

  const current = projects.find((p) => p.slug === currentSlug);

  /** Extract the sub-route after `/p/:slug/` and rebuild for a new slug. */
  function switchTo(slug: string) {
    if (slug === currentSlug) return;

    const path = routerState.location.pathname;
    // path looks like /p/flux/issues or /p/flux/sessions/abc123
    const prefix = `/p/${currentSlug}`;
    const subRoute = path.startsWith(prefix)
      ? path.slice(prefix.length) || "/issues"
      : "/issues";

    navigate({ to: `/p/${slug}${subRoute}` });

    // Close the dropdown
    const details = detailsRef.current;
    if (details) details.open = false;
  }

  return (
    <details ref={detailsRef} className="dropdown">
      <summary className="btn btn-ghost btn-sm gap-2 font-semibold">
        {current?.name ?? currentSlug}
        {current && <ProjectStateBadge enabled={current.enabled} />}
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
