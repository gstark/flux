import type { ConvexClient } from "convex/browser";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { ProjectState } from "$convex/schema";
import type { Orchestrator } from "./orchestrator";

type OrchestratorAction = "enable" | "stop" | "kill" | "status";

const VALID_ACTIONS: ReadonlySet<string> = new Set<OrchestratorAction>([
  "enable",
  "stop",
  "kill",
  "status",
]);

function isValidAction(value: string): value is OrchestratorAction {
  return VALID_ACTIONS.has(value);
}

/**
 * Dedicated API handler for orchestrator actions.
 *
 * Accepts POST requests with JSON body `{ action: "enable" | "stop" | "kill" | "status" }`.
 * This bypasses the generic MCP tool dispatch layer (`/api/tools`), giving the UI
 * a direct, purpose-built endpoint for orchestrator control.
 *
 * `enable` and `stop` are routed through Convex project state updates so the
 * project state watcher handles the actual orchestrator lifecycle. This prevents
 * desync between Convex project state and runtime orchestrator state (FLUX-307).
 *
 * `kill` and `status` remain direct orchestrator actions — they don't affect
 * lifecycle state that the watcher manages.
 *
 * The MCP tool handlers remain available for agent consumption via `/mcp/projects/:projectId`.
 */
export function createOrchestratorApiHandler(
  getOrchestrator: () => Orchestrator,
  convex: ConvexClient,
  projectId: Id<"projects">,
) {
  return async function handleOrchestratorApi(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json(
        { error: "Method not allowed. Use POST." },
        { status: 405 },
      );
    }

    const body = (await req.json()) as { action?: string };
    const { action } = body;

    if (!action || !isValidAction(action)) {
      return Response.json(
        {
          error: `Invalid action. Expected one of: ${[...VALID_ACTIONS].join(", ")}`,
        },
        { status: 400 },
      );
    }

    try {
      switch (action) {
        case "enable":
          // Route through Convex project state — the project state watcher
          // will observe the transition and call orchestrator.enable().
          await convex.mutation(api.projects.update, {
            projectId,
            state: ProjectState.Running,
          });
          // State change is async (watcher hasn't fired yet), so return
          // the requested state — not a stale getStatus() snapshot.
          return Response.json({ state: ProjectState.Running });

        case "stop":
          // Route through Convex project state — the project state watcher
          // will observe the transition and call orchestrator.stop().
          await convex.mutation(api.projects.update, {
            projectId,
            state: ProjectState.Stopped,
          });
          return Response.json({ state: ProjectState.Stopped });

        case "kill": {
          const orchestrator = getOrchestrator();
          await orchestrator.kill();
          return Response.json({ message: "Session killed." });
        }

        case "status":
          return Response.json({ status: getOrchestrator().getStatus() });

        default: {
          const _exhaustive: never = action;
          return Response.json(
            { error: `Unhandled action: ${_exhaustive}` },
            { status: 400 },
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}
