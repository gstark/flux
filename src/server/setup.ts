import { api } from "$convex/_generated/api";
import { getConvexClient } from "./convex";
import { inferProjectSlug } from "./git";

function titleize(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function ensureProject(): Promise<{
  projectId: string;
  projectSlug: string;
}> {
  const client = getConvexClient();
  const inferredSlug = await inferProjectSlug();

  // Check if project already exists
  const existing = await client.query(api.projects.get, {
    slug: inferredSlug,
  });

  if (existing) {
    console.log(`Project "${existing.name}" found.`);
    return { projectId: existing._id, projectSlug: existing.slug };
  }

  // Project doesn't exist — create with inferred defaults or interactive input
  let slug: string;
  let name: string;

  if (process.stdin.isTTY) {
    slug = prompt(`Project slug [${inferredSlug}]:`) || inferredSlug;
    const defaultName = titleize(slug);
    name = prompt(`Project name [${defaultName}]:`) || defaultName;
  } else {
    slug = inferredSlug;
    name = titleize(slug);
    console.log(`Non-interactive mode: creating project "${name}" (${slug}).`);
  }

  const projectId = await client.mutation(api.projects.create, { slug, name });
  console.log(`Project "${name}" created. Seeds scheduled.`);
  return { projectId, projectSlug: slug };
}
