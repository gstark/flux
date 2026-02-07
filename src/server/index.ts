import { serve } from "bun";
import type { Id } from "$convex/_generated/dataModel";
import index from "../index.html";
import { createApiHandler } from "./api";
import { getConvexClient } from "./convex";
import { createMcpHandler } from "./mcp";
import { getOrchestrator } from "./orchestrator";
import { createSSEHandler } from "./sse";
import type { ToolContext } from "./tools";

const DEFAULT_PORT = 8042;

export async function startServer(
  projectId: Id<"projects">,
  projectSlug: string,
) {
  const port = Number(process.env.FLUX_PORT) || DEFAULT_PORT;
  const handleMcp = createMcpHandler(projectId, projectSlug);

  const toolContext: ToolContext = {
    convex: getConvexClient(),
    projectId,
    projectSlug,
    getOrchestrator: () => getOrchestrator(projectId),
  };
  const handleApi = createApiHandler(toolContext);
  const handleSSE = createSSEHandler(() => getOrchestrator(projectId));

  const server = serve({
    port,
    idleTimeout: 0,
    routes: {
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
        return Response.json({ convexUrl, projectId });
      },

      "/mcp": (req) => handleMcp(req),
      "/api/tools": (req) => handleApi(req),
      "/sse/activity": (req) => handleSSE(req),

      // Serve React app for all unmatched routes (SPA fallback).
      "/*": index,
    },
    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: false,
    },
  });

  return server;
}
