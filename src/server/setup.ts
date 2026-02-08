import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { getConvexClient } from "./convex";
import { inferProjectSlug, resolveRepoRoot } from "./git";

/** Loaded project data passed through the server startup pipeline. */
export type Project = {
  _id: Id<"projects">;
  slug: string;
  name: string;
  path: string;
};

function titleize(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Load all registered projects from Convex.
 *
 * On first run (zero projects): falls back to CWD-based detection and
 * auto-registers a project — zero-friction migration for existing users.
 */
export async function loadProjects(): Promise<Project[]> {
  const client = getConvexClient();
  const allProjects = await client.query(api.projects.list, {});

  if (allProjects.length > 0) {
    const projects = allProjects.map((p) => ({
      _id: p._id,
      slug: p.slug,
      name: p.name,
      path: p.path ?? "",
    }));
    for (const p of projects) {
      if (!p.path) {
        console.warn(
          `[setup] Project "${p.slug}" has no path configured — ` +
            "agent spawning will fail until a path is set via PATCH /api/projects/:id",
        );
      }
    }
    console.log(
      `Loaded ${projects.length} project(s): ${projects.map((p) => p.slug).join(", ")}`,
    );
    return projects;
  }

  // Zero projects — auto-register from CWD (first-run migration)
  const slug = await inferProjectSlug();
  const repoRoot = await resolveRepoRoot();
  let name: string;

  if (process.stdin.isTTY) {
    const inputSlug = prompt(`Project slug [${slug}]:`) || slug;
    const defaultName = titleize(inputSlug);
    name = prompt(`Project name [${defaultName}]:`) || defaultName;
    const projectId = await client.mutation(api.projects.create, {
      slug: inputSlug,
      name,
      path: repoRoot,
    });
    console.log(`Project "${name}" created. Seeds scheduled.`);
    return [{ _id: projectId, slug: inputSlug, name, path: repoRoot }];
  }

  name = titleize(slug);
  console.log(
    `No projects registered. Auto-creating "${name}" (${slug}) from CWD.`,
  );
  const projectId = await client.mutation(api.projects.create, {
    slug,
    name,
    path: repoRoot,
  });
  console.log(`Project "${name}" created. Seeds scheduled.`);
  return [{ _id: projectId, slug, name, path: repoRoot }];
}
