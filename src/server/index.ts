import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "bun";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { handleToolRequest } from "./api";
import { getConvexClient } from "./convex";
import { handleMcpRequest } from "./mcp";
import { getOrCreateOrchestrator } from "./orchestrator/orchestrator";
import { createOrchestratorApiHandler } from "./orchestratorApi";
import { createProjectsApiHandler } from "./projectsApi";
import type { Project } from "./setup";
import { gracefulShutdown } from "./shutdown";
import { createSSEHandler } from "./sse";
import type { ToolContext } from "./tools";

const VERSION: string = JSON.parse(
  readFileSync(join(import.meta.dir, "../../package.json"), "utf-8"),
).version;

const DEFAULT_PORT = 8042;

/** Build a ToolContext for a specific project, optionally with session context from headers. */
function createToolContext(project: Project, req?: Request): ToolContext {
  const orchestrator = getOrCreateOrchestrator();
  const sessionId = req?.headers.get("X-Flux-Session-Id") ?? undefined;
  const agentName = req?.headers.get("X-Flux-Agent-Name") ?? undefined;
  const issueId = req?.headers.get("X-Flux-Issue-Id") ?? undefined;
  return {
    convex: getConvexClient(),
    projectId: project._id,
    projectSlug: project.slug,
    getRunner: () => orchestrator.getRunner(project._id),
    ...(sessionId && { sessionId: sessionId as Id<"sessions"> }),
    ...(agentName && { agentName }),
    ...(issueId && { issueId: issueId as Id<"issues"> }),
  };
}

/**
 * Parse project-scoped sub-routes from a URL path.
 */
function parseProjectScopedRoute(
  pathname: string,
): { projectId: string; subPath: string } | null {
  const apiMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/(orchestrator|config|tools)$/,
  );
  if (apiMatch?.[1] && apiMatch[2]) {
    return { projectId: apiMatch[1], subPath: apiMatch[2] };
  }
  const sseMatch = pathname.match(/^\/sse\/projects\/([^/]+)\/activity$/);
  if (sseMatch?.[1]) {
    return { projectId: sseMatch[1], subPath: "sse-activity" };
  }
  const mcpMatch = pathname.match(/^\/mcp\/projects\/([^/]+)$/);
  if (mcpMatch?.[1]) {
    return { projectId: mcpMatch[1], subPath: "mcp" };
  }
  return null;
}

export async function startServer() {
  const port = Number(process.env.FLUX_PORT) || DEFAULT_PORT;

  const handleProjectsApi = createProjectsApiHandler(getConvexClient());

  const convex = getConvexClient();
  const orchestrator = getOrCreateOrchestrator();

  async function handleProjectScoped(
    req: Request,
    projectId: string,
    subPath: string,
  ): Promise<Response> {
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

    const projectPath = project.path;

    // Guard: all branches except "config" and "sse-activity" require a configured path
    const needsPath = subPath !== "config" && subPath !== "sse-activity";
    if (needsPath && !projectPath) {
      return Response.json(
        { error: `Project ${projectId} has no path configured.` },
        { status: 400 },
      );
    }

    // Shared ToolContext for branches that use it (tools, mcp).
    // projectPath is guaranteed non-null when needsPath is true.
    const toolCtx =
      subPath === "tools" || subPath === "mcp"
        ? createToolContext(
            {
              _id: project._id,
              slug: project.slug,
              name: project.name,
              path: projectPath as string,
            },
            req,
          )
        : null;

    switch (subPath) {
      case "orchestrator": {
        const runner = orchestrator.getRunner(projectId as Id<"projects">);
        if (!runner) {
          return Response.json(
            {
              error: `No runner for project ${projectId}. Does the project have a valid path?`,
            },
            { status: 400 },
          );
        }
        const handler = createOrchestratorApiHandler(() => runner);
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
          enabled: project.enabled ?? false,
        });
      }

      case "tools":
        return handleToolRequest(req, toolCtx as ToolContext);

      case "sse-activity": {
        const handler = createSSEHandler(() =>
          orchestrator.getRunner(projectId as Id<"projects">),
        );
        return handler(req);
      }

      case "mcp":
        return handleMcpRequest(req, toolCtx as ToolContext);

      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  }

  const routes: Record<
    string,
    Response | ((req: Request) => Response | Promise<Response>)
  > = {
    "/health": () => {
      const health = orchestrator.getHealthInfo();
      const rss = process.memoryUsage.rss();
      return Response.json({
        status: "ok",
        timestamp: Date.now(),
        uptime: Math.floor(process.uptime()),
        version: VERSION,
        projects: health.projects,
        sessions: health.activeSessions,
        memory: { rss: Math.round(rss / 1024 / 1024) },
      });
    },

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

    "/mcp": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /mcp/projects/:projectId instead.",
        },
        { status: 410 },
      ),
    "/api/tools": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /api/projects/:projectId/tools instead.",
        },
        { status: 410 },
      ),

    "/api/orchestrator": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use POST /api/projects/:projectId/orchestrator instead.",
        },
        { status: 410 },
      ),

    "/sse/activity": () =>
      Response.json(
        {
          error:
            "This endpoint has been removed. Use GET /sse/projects/:projectId/activity instead.",
        },
        { status: 410 },
      ),

    "/api/projects": (req) => handleProjectsApi(req),

    "/api/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      return handleProjectsApi(req);
    },

    "/sse/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      return Response.json({ error: "Not found." }, { status: 404 });
    },

    "/mcp/projects/*": (req) => {
      const url = new URL(req.url);
      const scoped = parseProjectScopedRoute(url.pathname);
      if (scoped) {
        return handleProjectScoped(req, scoped.projectId, scoped.subPath);
      }
      return Response.json({ error: "Not found." }, { status: 404 });
    },
  };

  if (process.env.NODE_ENV === "production") {
    const distDir = join(import.meta.dir, "../../dist");
    routes["/*"] = async (req: Request) => {
      const url = new URL(req.url);
      const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = Bun.file(join(distDir, filePath));
      if (await file.exists()) return new Response(file);
      return new Response(Bun.file(join(distDir, "index.html")), {
        headers: { "Content-Type": "text/html" },
      });
    };
  } else {
    // Dev mode: reverse-proxy to Vite for frontend assets and SPA routes.
    // Vite's port is picked up from FLUX_VITE_PORT (set by `flux daemon install`).
    const vitePort = Number(process.env.FLUX_VITE_PORT) || 8043;
    const VITE_ORIGIN = `http://localhost:${vitePort}`;
    routes["/*"] = async (req: Request) => {
      const url = new URL(req.url);
      const target = new URL(url.pathname + url.search, VITE_ORIGIN);
      const headers = new Headers(req.headers);
      headers.set("host", target.host);
      try {
        return await fetch(target, {
          method: req.method,
          headers,
          body: req.body,
        });
      } catch {
        return new Response("Vite dev server not reachable at " + VITE_ORIGIN, {
          status: 502,
        });
      }
    };
  }

  const server = serve({
    port,
    idleTimeout: 0,
    routes,
  });

  // Start the orchestrator — watches projects and auto-manages runners
  await orchestrator.start();

  // Install signal handlers for graceful shutdown.
  let shutdownInProgress = false;
  const handleSignal = (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`[Server] Received ${signal} — initiating graceful shutdown`);
    gracefulShutdown({ server, orchestrator }).then(
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
