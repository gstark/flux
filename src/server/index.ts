import { join } from "node:path";
import { serve } from "bun";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { handleToolRequest } from "./api";
import { getConvexClient } from "./convex";
import { handleMcpRequest } from "./mcp";
import { getOrchestrator } from "./orchestrator";
import { createOrchestratorApiHandler } from "./orchestratorApi";
import { startProjectStateWatcher } from "./projectStateWatcher";
import { createProjectsApiHandler } from "./projectsApi";
import type { Project } from "./setup";
import { gracefulShutdown } from "./shutdown";
import { createSSEHandler } from "./sse";
import { recoverRunningProjects } from "./startupRecovery";
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
        const handler = createOrchestratorApiHandler(
          () => getOrchestrator(projectId as Id<"projects">, projectPath),
          convex,
          projectId as Id<"projects">,
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
        const ctx = createToolContext({
          _id: project._id,
          slug: project.slug,
          name: project.name,
          path: projectPath,
        });
        return handleMcpRequest(req, ctx);
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
      return Response.json({ convexUrl });
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
    // Legacy tools endpoint — replaced by /api/projects/:id/tools
    "/api/tools": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /api/projects/:projectId/tools instead.",
        },
        { status: 410 },
      ),

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

  // FLUX-280: Eagerly recover projects in 'running' state before starting
  // the watcher. This creates orchestrators and runs orphan recovery for each,
  // logging a summary of what was found. The returned initial states seed the
  // watcher so it doesn't redundantly re-enable these orchestrators.
  const initialStates = await recoverRunningProjects();

  // Subscribe to project state changes and drive orchestrator lifecycle.
  // Runs after server bind so orchestrator APIs are available immediately.
  const unsubscribeWatcher = startProjectStateWatcher(initialStates);

  // Install signal handlers for graceful shutdown.
  // SIGTERM: sent by launchd (or `kill <pid>`) before SIGKILL.
  // SIGINT: sent by Ctrl+C in dev mode.
  // Guard against duplicate signals — only the first triggers shutdown.
  let shutdownInProgress = false;
  const handleSignal = (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`[Server] Received ${signal} — initiating graceful shutdown`);
    gracefulShutdown({ server, unsubscribeWatcher }).then(
      () => process.exit(0),
      (err) => {
        console.error("[Server] Graceful shutdown failed:", err);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  return server;
}
