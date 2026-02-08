import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { getConvexClient } from "./convex";
import { inferProjectSlug, resolveRepoRoot, validateProjectPath } from "./git";

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

    // Auto-backfill: single-project setups with empty path get CWD resolved.
    // Multi-project setups warn instead — ambiguous which path to assign.
    const onlyProject = projects.length === 1 ? projects[0] : undefined;
    if (onlyProject && !onlyProject.path) {
      try {
        const repoRoot = await resolveRepoRoot();
        const validation = await validateProjectPath(repoRoot);
        if (validation.ok) {
          await client.mutation(api.projects.update, {
            projectId: onlyProject._id,
            path: repoRoot,
          });
          onlyProject.path = repoRoot;
          console.log(
            `[setup] Auto-detected path for "${onlyProject.slug}": ${repoRoot}`,
          );
        } else {
          console.warn(
            `[setup] CWD repo root "${repoRoot}" failed validation: ${validation.error}`,
          );
        }
      } catch (err) {
        console.warn(
          `[setup] Could not auto-detect path for "${onlyProject.slug}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      for (const p of projects) {
        if (!p.path) {
          console.warn(
            `[setup] Project "${p.slug}" has no path configured — ` +
              "agent spawning will fail until a path is set via PATCH /api/projects/:id",
          );
        }
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
