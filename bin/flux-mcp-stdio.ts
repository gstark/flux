import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { callFluxTool } from "../src/server/fluxToolHttp";
import { allTools } from "../src/server/tools/schema";

const FLUX_URL = process.env.FLUX_URL ?? "http://localhost:8042";

/**
 * Resolve the project ID — explicit env var takes precedence, otherwise
 * auto-discover by listing projects from the Flux API. If there is exactly
 * one project, use it automatically (zero-config for single-project setups).
 */
async function resolveProjectId(): Promise<string> {
  const explicit = process.env.FLUX_PROJECT_ID;
  if (explicit) return explicit;

  const res = await fetch(`${FLUX_URL}/api/projects`);
  if (!res.ok) {
    console.error(
      `Failed to list projects from ${FLUX_URL}/api/projects: ${res.status} ${res.statusText}`,
    );
    process.exit(1);
  }

  const projects: { id: string }[] = await res.json();

  if (projects.length === 0) {
    console.error(
      "No projects found. Create a project first, or set FLUX_PROJECT_ID.",
    );
    process.exit(1);
  }

  if (projects.length > 1) {
    console.error(
      `Multiple projects found (${projects.length}). Set FLUX_PROJECT_ID to one of:\n${projects.map((p) => `  ${p.id}`).join("\n")}`,
    );
    process.exit(1);
  }

  return projects[0].id;
}

const projectId = await resolveProjectId();
const toolsUrl = `${FLUX_URL}/api/projects/${projectId}/tools`;

// Session context from environment (set by orchestrator when spawning agents)
const sessionId = process.env.FLUX_SESSION_ID;
const agentName = process.env.FLUX_AGENT_NAME;

const mcp = new McpServer({ name: "flux", version: "0.1.0" });

for (const tool of allTools) {
  mcp.tool(tool.name, tool.description, tool.schema, async (args) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Include session context in headers if available
    if (sessionId) headers["X-Flux-Session-Id"] = sessionId;
    if (agentName) headers["X-Flux-Agent-Name"] = agentName;

    return callFluxTool({
      fluxUrl: FLUX_URL,
      toolsUrl,
      tool: tool.name,
      payload: { tool: tool.name, args },
      headers,
    });
  });
}

const transport = new StdioServerTransport();
await mcp.connect(transport);
