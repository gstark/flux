import type { ConvexClient } from "convex/browser";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { inferProjectSlug, validateProjectPath } from "./git";
import { sanitizeConvexError } from "./sanitizeError";

/**
 * Extract the Convex document ID from the URL path.
 * Given "/api/projects/abc123", returns "abc123".
 * Returns null if the path is just "/api/projects" or "/api/projects/".
 */
function extractProjectId(url: URL): string | null {
  const parts = url.pathname.replace(/\/+$/, "").split("/");
  // Expected: ["", "api", "projects", "<id>"]
  if (parts.length >= 4 && parts[3]) {
    return parts[3];
  }
  return null;
}

/**
 * REST API handler for project CRUD.
 *
 * - GET    /api/projects        — list all projects with issue counts
 * - GET    /api/projects/:id    — get a single project with issue counts
 * - POST   /api/projects        — create a project (body: { path })
 * - PATCH  /api/projects/:id    — update project fields
 * - DELETE /api/projects/:id    — remove a project
 */
export function createProjectsApiHandler(convex: ConvexClient) {
  return async function handleProjectsApi(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = extractProjectId(url);

    switch (req.method) {
      case "GET":
        return id ? handleGet(convex, id) : handleList(convex);
      case "POST":
        if (id) {
          return Response.json(
            { error: "POST /api/projects does not accept an ID in the path." },
            { status: 400 },
          );
        }
        return handleCreate(convex, req);
      case "PATCH":
        return handleUpdate(convex, req, id);
      case "DELETE":
        return handleDelete(convex, id);
      default:
        return Response.json(
          { error: `Method ${req.method} not allowed.` },
          { status: 405 },
        );
    }
  };
}

async function handleList(convex: ConvexClient): Promise<Response> {
  try {
    const projects = await convex.query(api.projects.list, {});
    // Fetch issue counts for each project in parallel
    const results = await Promise.all(
      projects.map(async (project) => {
        const counts = await convex.query(api.issues.counts, {
          projectId: project._id,
        });
        return {
          id: project._id,
          slug: project.slug,
          name: project.name,
          path: project.path ?? null,
          enabled: project.enabled ?? false,
          issueCounts: counts,
        };
      }),
    );
    return Response.json(results);
  } catch (err) {
    const message = sanitizeConvexError(
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleGet(convex: ConvexClient, id: string): Promise<Response> {
  try {
    const project = await convex.query(api.projects.getById, {
      projectId: id as Id<"projects">,
    });
    if (!project) {
      return Response.json(
        { error: `Project ${id} not found.` },
        { status: 404 },
      );
    }
    const counts = await convex.query(api.issues.counts, {
      projectId: project._id,
    });
    return Response.json({
      id: project._id,
      slug: project.slug,
      name: project.name,
      path: project.path ?? null,
      enabled: project.enabled ?? false,
      issueCounts: counts,
    });
  } catch (err) {
    const message = sanitizeConvexError(
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleCreate(
  convex: ConvexClient,
  req: Request,
): Promise<Response> {
  let body: { path?: string };
  try {
    body = (await req.json()) as { path?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { path } = body;
  if (!path || typeof path !== "string") {
    return Response.json(
      { error: "Missing required field: path" },
      { status: 400 },
    );
  }

  // Validate the path is an existing git repository
  const validation = await validateProjectPath(path);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const slug = await inferProjectSlug(path);
  const name = slug; // Use slug as initial display name

  try {
    const projectId = await convex.mutation(api.projects.create, {
      slug,
      name,
      path,
    });
    const project = await convex.query(api.projects.getById, { projectId });
    if (!project) {
      return Response.json(
        { error: "Project created but could not be retrieved." },
        { status: 500 },
      );
    }
    return Response.json(
      {
        id: project._id,
        slug: project.slug,
        name: project.name,
        path: project.path ?? null,
        enabled: project.enabled ?? false,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = sanitizeConvexError(
      err instanceof Error ? err.message : String(err),
    );
    // Convex throws on duplicate slug — surface as 409 Conflict
    if (message.includes("already exists")) {
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleUpdate(
  convex: ConvexClient,
  req: Request,
  id: string | null,
): Promise<Response> {
  if (!id) {
    return Response.json(
      { error: "Missing project ID in URL path." },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates: {
    projectId: Id<"projects">;
    name?: string;
    slug?: string;
    path?: string;
    enabled?: boolean;
  } = { projectId: id as Id<"projects"> };

  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.slug === "string") updates.slug = body.slug;
  if (typeof body.path === "string") {
    const validation = await validateProjectPath(body.path);
    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: 400 });
    }
    updates.path = body.path;
  }
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled;
  }

  // Check that at least one field is being updated (beyond projectId)
  if (Object.keys(updates).length <= 1) {
    return Response.json(
      {
        error: "No valid fields to update. Accepted: name, slug, path, enabled",
      },
      { status: 400 },
    );
  }

  try {
    await convex.mutation(api.projects.update, updates);
    const project = await convex.query(api.projects.getById, {
      projectId: id as Id<"projects">,
    });
    if (!project) {
      return Response.json(
        { error: `Project ${id} not found after update.` },
        { status: 404 },
      );
    }
    return Response.json({
      id: project._id,
      slug: project.slug,
      name: project.name,
      path: project.path ?? null,
      enabled: project.enabled ?? false,
    });
  } catch (err) {
    const message = sanitizeConvexError(
      err instanceof Error ? err.message : String(err),
    );
    if (message.includes("not found")) {
      return Response.json({ error: message }, { status: 404 });
    }
    if (message.includes("already taken")) {
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

async function handleDelete(
  convex: ConvexClient,
  id: string | null,
): Promise<Response> {
  if (!id) {
    return Response.json(
      { error: "Missing project ID in URL path." },
      { status: 400 },
    );
  }

  try {
    await convex.mutation(api.projects.remove, {
      projectId: id as Id<"projects">,
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    const message = sanitizeConvexError(
      err instanceof Error ? err.message : String(err),
    );
    if (message.includes("not found")) {
      return Response.json({ error: message }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
