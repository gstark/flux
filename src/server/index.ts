import { join } from "node:path";
import { serve } from "bun";
import type { Id } from "$convex/_generated/dataModel";
import { createApiHandler } from "./api";
import { getConvexClient } from "./convex";
import { createMcpHandler } from "./mcp";
import { getOrchestrator } from "./orchestrator";
import { createOrchestratorApiHandler } from "./orchestratorApi";
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

  const handleMcp = createMcpHandler(
    defaultProject._id,
    defaultProject.slug,
    defaultProject.path,
  );
  const handleApi = createApiHandler(defaultCtx);
  const handleSSE = createSSEHandler(() =>
    getOrchestrator(defaultProject._id, defaultProject.path),
  );
  const handleOrchestratorApi = createOrchestratorApiHandler(() =>
    getOrchestrator(defaultProject._id, defaultProject.path),
  );
  const handleProjectsApi = createProjectsApiHandler(getConvexClient());

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
        // Backward compat: single projectId for current UI
        projectId: defaultProject._id,
        // Full project list for multi-project consumers
        projects: projects.map((p) => ({
          _id: p._id,
          slug: p.slug,
          name: p.name,
          path: p.path,
        })),
      });
    },

    "/mcp": (req) => handleMcp(req),
    "/api/tools": (req) => handleApi(req),
    "/api/orchestrator": (req) => handleOrchestratorApi(req),
    "/api/projects": (req) => handleProjectsApi(req),
    "/api/projects/*": (req) => handleProjectsApi(req),
    "/sse/activity": (req) => handleSSE(req),
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

  return server;
}
