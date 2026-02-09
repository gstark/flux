import type { ProjectRunner } from "./orchestrator";
import { sanitizeConvexError } from "./sanitizeError";

type OrchestratorAction = "kill" | "status";

const VALID_ACTIONS: ReadonlySet<string> = new Set<OrchestratorAction>([
  "kill",
  "status",
]);

function isValidAction(value: string): value is OrchestratorAction {
  return VALID_ACTIONS.has(value);
}

/**
 * Dedicated API handler for orchestrator actions.
 *
 * Accepts POST requests with JSON body `{ action: "kill" | "status" }`.
 * This bypasses the generic MCP tool dispatch layer (`/api/projects/:id/tools`), giving the UI
 * a direct, purpose-built endpoint for orchestrator control.
 *
 * `kill` and `status` are direct runner actions — they don't affect lifecycle state.
 */
export function createOrchestratorApiHandler(getRunner: () => ProjectRunner) {
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
        case "kill": {
          const runner = getRunner();
          await runner.kill();
          return Response.json({ message: "Session killed." });
        }

        case "status":
          return Response.json({ status: getRunner().getStatus() });

        default: {
          const _exhaustive: never = action;
          return Response.json(
            { error: `Unhandled action: ${_exhaustive}` },
            { status: 400 },
          );
        }
      }
    } catch (err) {
      const message = sanitizeConvexError(err);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}
