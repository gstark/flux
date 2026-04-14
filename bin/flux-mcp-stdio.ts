import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFluxConfig } from "../src/server/fluxConfig";
import { callFluxTool } from "../src/server/fluxToolHttp";
import { allTools } from "../src/server/tools/schema";
import { resolveFluxUrl } from "../src/shared/fluxUrl";

const FLUX_URL = resolveFluxUrl();

/**
 * Find the git repo root by walking up from cwd.
 */
async function gitRepoRoot(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return code === 0 ? text.trim() : null;
}

/**
 * Resolve the project ID:
 * 1. FLUX_PROJECT_ID env var (explicit wins)
 * 2. .flux file at git repo root
 * 3. Auto-discover from API (single project only)
 */
async function resolveProjectId(): Promise<string> {
  const explicit = process.env.FLUX_PROJECT_ID;
  if (explicit) return explicit;

  // Read .flux file from git repo root (supports bare ID and TOML)
  const repoRoot = await gitRepoRoot();
  if (repoRoot) {
    const config = await readFluxConfig(repoRoot);
    if (config) return config.projectId;
  }

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
const issueId = process.env.FLUX_ISSUE_ID;

const mcp = new McpServer({ name: "flux", version: "0.1.0" });

for (const tool of allTools) {
  mcp.tool(tool.name, tool.description, tool.schema, async (args) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Include session context in headers if available
    if (sessionId) headers["X-Flux-Session-Id"] = sessionId;
    if (agentName) headers["X-Flux-Agent-Name"] = agentName;
    if (issueId) headers["X-Flux-Issue-Id"] = issueId;

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
