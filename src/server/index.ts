import { join } from "node:path";
import { serve } from "bun";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { createApiHandler, handleToolRequest } from "./api";
import { getConvexClient } from "./convex";
import { handleMcpRequest } from "./mcp";
import { getOrchestrator } from "./orchestrator";
import { createOrchestratorApiHandler } from "./orchestratorApi";
import { startProjectStateWatcher } from "./projectStateWatcher";
import { createProjectsApiHandler } from "./projectsApi";
import type { Project } from "./setup";
import { createSSEHandler } from "./sse";
import type { ToolContext } from "./tools";

const DEFAULT_PORT = 8042;

/** Build a ToolContext for a specific project. */
function createToolContext(project: Project): ToolContext {
  return {
    convex: getConvexClient(),
    projectId: project._id,
    projectSlug: project.slug,
    getOrchestrator: () => getOrchestrator(project._id, project.path),
  };
}

/**
 * Parse project-scoped sub-routes from a URL path.
 *
 * Given `/api/projects/<id>/orchestrator`, returns `{ projectId: "<id>", subPath: "orchestrator" }`.
 * Given `/api/projects/<id>/config`, returns `{ projectId: "<id>", subPath: "config" }`.
 * Given `/api/projects/<id>/tools`, returns `{ projectId: "<id>", subPath: "tools" }`.
 * Given `/sse/projects/<id>/activity`, returns `{ projectId: "<id>", subPath: "sse-activity" }`.
 * Given `/mcp/projects/<id>`, returns `{ projectId: "<id>", subPath: "mcp" }`.
 * Returns null for paths that don't match a project-scoped sub-route.
 */
function parseProjectScopedRoute(
  pathname: string,
): { projectId: string; subPath: string } | null {
  // Match /api/projects/:id/<sub>
  const apiMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/(orchestrator|config|tools)$/,
  );
  if (apiMatch?.[1] && apiMatch[2]) {
    return { projectId: apiMatch[1], subPath: apiMatch[2] };
  }
  // Match /sse/projects/:id/activity
  const sseMatch = pathname.match(/^\/sse\/projects\/([^/]+)\/activity$/);
  if (sseMatch?.[1]) {
    return { projectId: sseMatch[1], subPath: "sse-activity" };
  }
  // Match /mcp/projects/:id
  const mcpMatch = pathname.match(/^\/mcp\/projects\/([^/]+)$/);
  if (mcpMatch?.[1]) {
    return { projectId: mcpMatch[1], subPath: "mcp" };
  }
  return null;
}

export async function startServer(projects: Project[]) {
  if (projects.length === 0) {
    throw new Error("startServer requires at least one project");
  }

  const port = Number(process.env.FLUX_PORT) || DEFAULT_PORT;

  // Index projects by ID for per-request lookup
  const projectsById = new Map<string, Project>();
  for (const p of projects) {
    projectsById.set(p._id, p);
  }

  // Default project: first in the list (backward compat for single-project flows).
  // Length check above guarantees this is defined.
  const defaultProject = projects[0] as Project;

  // Per-project ToolContext — created lazily and cached
  const toolContextCache = new Map<string, ToolContext>();
  function getToolContext(projectId: Id<"projects">): ToolContext {
    const cached = toolContextCache.get(projectId);
    if (cached) return cached;
    const project = projectsById.get(projectId);
    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    const ctx = createToolContext(project);
    toolContextCache.set(projectId, ctx);
    return ctx;
  }

  // Default context for handlers that don't yet support multi-project
  const defaultCtx = getToolContext(defaultProject._id);

  const handleApi = createApiHandler(defaultCtx);
  const handleProjectsApi = createProjectsApiHandler(getConvexClient());

  const convex = getConvexClient();

  /**
   * Handle project-scoped requests:
   *   POST /api/projects/:id/orchestrator
   *   GET  /api/projects/:id/config
   *   POST /api/projects/:id/tools
   *   POST /mcp/projects/:id
   *   GET  /sse/projects/:id/activity
   *
   * Validates the project exists in Convex before dispatching.
   */
  async function handleProjectScoped(
    req: Request,
    projectId: string,
    subPath: string,
  ): Promise<Response> {
    // Validate project exists in Convex.
    // Convex throws on malformed IDs — catch and surface as 404.
    let project: Awaited<
      ReturnType<typeof convex.query<typeof api.projects.getById>>
    >;
    try {
      project = await convex.query(api.projects.getById, {
        projectId: projectId as Id<"projects">,
      });
    } catch {
      return Response.json(
        { error: `Project ${projectId} not found.` },
        { status: 404 },
      );
    }
    if (!project) {
      return Response.json(
        { error: `Project ${projectId} not found.` },
        { status: 404 },
      );
    }

    // Ensure the project has a path (required for orchestrator/SSE)
    const projectPath = project.path;

    switch (subPath) {
      case "orchestrator": {
        if (!projectPath) {
          return Response.json(
            { error: `Project ${projectId} has no path configured.` },
            { status: 400 },
          );
        }
        const handler = createOrchestratorApiHandler(() =>
          getOrchestrator(projectId as Id<"projects">, projectPath),
        );
        return handler(req);
      }

      case "config": {
        if (req.method !== "GET") {
          return Response.json(
            { error: "Method not allowed. Use GET." },
            { status: 405 },
          );
        }
        const convexUrl = process.env.CONVEX_URL;
        if (!convexUrl) {
          return Response.json(
            { error: "CONVEX_URL not configured" },
            { status: 500 },
          );
        }
        return Response.json({
          convexUrl,
          projectId: project._id,
          slug: project.slug,
          name: project.name,
          path: project.path ?? null,
          state: project.state ?? null,
        });
      }

      case "tools": {
        if (!projectPath) {
          return Response.json(
            { error: `Project ${projectId} has no path configured.` },
            { status: 400 },
          );
        }
        const ctx = createToolContext({
          _id: project._id,
          slug: project.slug,
          name: project.name,
          path: projectPath,
        });
        return handleToolRequest(req, ctx);
      }

      case "sse-activity": {
        if (!projectPath) {
          return Response.json(
            { error: `Project ${projectId} has no path configured.` },
            { status: 400 },
          );
        }
        const handler = createSSEHandler(() =>
          getOrchestrator(projectId as Id<"projects">, projectPath),
        );
        return handler(req);
      }

      case "mcp": {
        if (!projectPath) {
          return Response.json(
            { error: `Project ${projectId} has no path configured.` },
            { status: 400 },
          );
        }
        return handleMcpRequest(req, {
          projectId: projectId as Id<"projects">,
          projectSlug: project.slug,
          projectPath,
        });
      }

      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  }

  const routes: Record<
    string,
    Response | ((req: Request) => Response | Promise<Response>)
  > = {
    "/health": () =>
      Response.json({
        status: "ok",
        timestamp: Date.now(),
        uptime: process.uptime(),
      }),

    "/api/config": () => {
      const convexUrl = process.env.CONVEX_URL;
      if (!convexUrl) {
        return Response.json(
          { error: "CONVEX_URL not configured" },
          { status: 500 },
        );
      }
      return Response.json({
        convexUrl,
        projects: projects.map((p) => ({
          _id: p._id,
          slug: p.slug,
          name: p.name,
          path: p.path,
        })),
      });
    },

    // Legacy MCP endpoint — replaced by /mcp/projects/:id
    "/mcp": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /mcp/projects/:projectId instead.",
        },
        { status: 410 },
      ),
    "/api/tools": (req) => handleApi(req),

    // Legacy orchestrator endpoint — replaced by /api/projects/:id/orchestrator
    "/api/orchestrator": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /api/projects/:projectId/orchestrator instead.",
        },
        { status: 410 },
      ),

    // Legacy SSE endpoint — replaced by /sse/projects/:id/activity
    "/sse/activity": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use GET /sse/projects/:projectId/activity instead.",
        },
        { status: 410 },
      ),

    // Project CRUD routes (top-level)
    "/api/projects": (req) => handleProjectsApi(req),

    // Wildcard: handles both /api/projects/:id (CRUD) and
    // /api/projects/:id/orchestrator, /api/projects/:id/config, /api/projects/:id/tools
    "/api/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      // Fall through to project CRUD handler (e.g. /api/projects/:id)
      return handleProjectsApi(req);
    },

    // SSE project-scoped wildcard
    "/sse/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      return Response.json({ error: "Not found." }, { status: 404 });
    },

    // MCP project-scoped wildcard
    "/mcp/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      return Response.json({ error: "Not found." }, { status: 404 });
    },
  };

  // In production, serve the Vite-built frontend from dist/.
  if (process.env.NODE_ENV === "production") {
    const distDir = join(import.meta.dir, "../../dist");
    routes["/*"] = async (req: Request) => {
      const url = new URL(req.url);
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(distDir, filePath));
      if (await file.exists()) return new Response(file);
      // SPA fallback: serve index.html for client-side routes.
      return new Response(Bun.file(join(distDir, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    };
  }

  const server = serve({
    port,
    idleTimeout: 0,
    routes,
  });

  // Subscribe to project state changes and drive orchestrator lifecycle.
  // Runs after server bind so orchestrator APIs are available immediately.
  startProjectStateWatcher();

  return server;
}
