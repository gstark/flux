import type { OrchestratorStatusData } from "@/shared/orchestrator";

type OrchestratorAction = "kill" | "status";

/**
 * Call the dedicated orchestrator API endpoint for a specific project.
 *
 * Routes to `/api/projects/:projectId/orchestrator` — a purpose-built route
 * that skips the generic MCP tool dispatch layer used by agents.
 *
 * Only `kill` and `status` are exposed — the orchestrator is always on
 * and auto-schedules based on project.enabled.
 */
async function callOrchestratorApi<T = unknown>(
  projectId: string,
  action: OrchestratorAction,
): Promise<T> {
  const res = await fetch(`/api/projects/${projectId}/orchestrator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      (body as { error?: string })?.error ??
      `Orchestrator action failed: ${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return (await res.json()) as T;
}

/** Kill the active session (SIGTERM). */
export function killOrchestrator(
  projectId: string,
): Promise<{ message: string }> {
  return callOrchestratorApi<{ message: string }>(projectId, "kill");
}

/** Fetch current orchestrator status. */
export function fetchOrchestratorStatus(
  projectId: string,
): Promise<OrchestratorStatusData> {
  return callOrchestratorApi<OrchestratorStatusData>(projectId, "status");
}
