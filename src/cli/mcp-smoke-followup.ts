import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveFluxUrl } from "../shared/fluxUrl";

const FLUX_URL = resolveFluxUrl();
const HTTP_TIMEOUT_MS = 3_000;

type FluxProject = {
  id: string;
  slug: string;
  path: string | null;
};

type FluxHealth = {
  status: string;
  version: string;
  uptime: number;
  projects: { total: number; idle: number; busy: number };
  sessions: number;
  memory: { rss: number };
};

type FluxToolDiagnostic = {
  error:
    | "flux_tool_timeout"
    | "flux_tool_transport_error"
    | "flux_tool_http_error";
  tool: string;
  elapsedMs: number;
  timeoutMs: number;
  status?: number;
  statusText?: string;
  responseSnippet?: string;
  cause?: string;
  health?: {
    reachable: boolean;
    status?: string;
    version?: string;
    sessions?: number;
    projects?: { total?: number; busy?: number; idle?: number };
    memoryMb?: number;
    error?: string;
  };
};

type FluxToolPayload = {
  error?: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

type CreatedIssue = {
  _id: string;
  shortId: string;
  title: string;
};

function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function mcpServerPath(): string {
  return resolve(repoRoot(), "bin/flux-mcp-stdio.ts");
}

function normalizePath(path: string): string {
  return realpathSync(path);
}

function buildSpawnEnv(projectId: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.FLUX_URL = FLUX_URL;
  env.FLUX_PROJECT_ID = projectId;
  return env;
}

async function fetchJsonOrThrow<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `HTTP ${response.status} ${response.statusText} from ${url}: ${body.trim() || "<empty body>"}`,
    );
  }
  return (await response.json()) as T;
}

async function fetchHealthOrThrow(): Promise<FluxHealth> {
  return fetchJsonOrThrow<FluxHealth>(`${FLUX_URL}/health`);
}

async function resolveProjectOrThrow(): Promise<FluxProject> {
  const projects = await fetchJsonOrThrow<FluxProject[]>(
    `${FLUX_URL}/api/projects`,
  );
  const explicitId = process.env.FLUX_PROJECT_ID;
  if (explicitId) {
    const explicitProject = projects.find(
      (project) => project.id === explicitId,
    );
    if (!explicitProject) {
      throw new Error(
        `FLUX_PROJECT_ID=${explicitId} was not found in ${FLUX_URL}/api/projects`,
      );
    }
    return explicitProject;
  }

  const cwd = normalizePath(process.cwd());
  const cwdProject = projects.find(
    (project) => project.path && normalizePath(project.path) === cwd,
  );
  if (cwdProject) {
    return cwdProject;
  }

  if (projects.length === 1) {
    return projects[0] as FluxProject;
  }

  throw new Error(
    `Could not infer Flux project for cwd ${cwd}. Set FLUX_PROJECT_ID to one of:\n${projects.map((project) => `  ${project.id} (${project.slug})`).join("\n")}`,
  );
}

function formatHealthSummary(health: FluxHealth): string {
  return `status=${health.status} version=${health.version} projects=${health.projects.total} total (${health.projects.busy} busy, ${health.projects.idle} idle) sessions=${health.sessions} rss=${health.memory.rss}MB uptime=${health.uptime}s`;
}

function parseToolTextContent(
  result: Awaited<ReturnType<Client["callTool"]>>,
  tool: string,
): string {
  if (!Array.isArray(result.content)) {
    throw new Error(`${tool} returned non-array content`);
  }
  const textBlock = result.content.find(
    (item): item is { type: "text"; text: string } =>
      !!item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string",
  );
  if (!textBlock) {
    throw new Error(`${tool} returned no text content`);
  }
  return textBlock.text;
}

function formatDiagnostic(diagnostic: FluxToolDiagnostic): string {
  const parts = [
    `${diagnostic.tool} returned ${diagnostic.error}`,
    `elapsed=${diagnostic.elapsedMs}ms`,
    `timeout=${diagnostic.timeoutMs}ms`,
  ];
  if (diagnostic.status) {
    parts.push(
      `http=${diagnostic.status} ${diagnostic.statusText ?? ""}`.trim(),
    );
  }
  if (diagnostic.cause) {
    parts.push(`cause=${diagnostic.cause}`);
  }
  if (diagnostic.responseSnippet) {
    parts.push(`response=${diagnostic.responseSnippet}`);
  }
  if (diagnostic.health) {
    const health = diagnostic.health;
    parts.push(
      health.reachable
        ? `health=status=${health.status ?? "unknown"} version=${health.version ?? "unknown"} projects=${health.projects?.total ?? "?"} total (${health.projects?.busy ?? "?"} busy, ${health.projects?.idle ?? "?"} idle) sessions=${health.sessions ?? "?"} rss=${health.memoryMb ?? "?"}MB`
        : `health=unreachable (${health.error ?? "unknown error"})`,
    );
  }
  return parts.join(" | ");
}

function parseToolPayload(
  result: Awaited<ReturnType<Client["callTool"]>>,
  tool: string,
): FluxToolPayload {
  const text = parseToolTextContent(result, tool);
  let payload: FluxToolPayload;
  try {
    payload = JSON.parse(text) as FluxToolPayload;
  } catch (error) {
    throw new Error(
      `${tool} returned non-JSON payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    payload.error === "flux_tool_timeout" ||
    payload.error === "flux_tool_transport_error" ||
    payload.error === "flux_tool_http_error"
  ) {
    throw new Error(formatDiagnostic(payload as FluxToolDiagnostic));
  }

  if (result.isError || typeof payload.error === "string") {
    throw new Error(`${tool} failed: ${payload.error ?? text}`);
  }

  return payload;
}

function assertIssue(value: unknown, tool: string): CreatedIssue {
  if (!value || typeof value !== "object") {
    throw new Error(`${tool} returned no issue payload`);
  }
  const issue = value as Partial<CreatedIssue>;
  if (!issue._id || !issue.shortId || !issue.title) {
    throw new Error(`${tool} returned incomplete issue payload`);
  }
  return issue as CreatedIssue;
}

function buildSmokeTitle(): string {
  return `[smoke] MCP follow-up transport ${new Date().toISOString()}`;
}

function buildSmokeDescription(
  project: FluxProject,
  health: FluxHealth,
): string {
  return [
    "Temporary issue created by `flux mcp smoke-followup`.",
    "",
    `Project: ${project.slug} (${project.id})`,
    `Health: ${formatHealthSummary(health)}`,
    "Expected lifecycle: create through MCP stdio bridge, then close immediately through the same bridge.",
  ].join("\n");
}

export async function mcpSmokeFollowup(): Promise<void> {
  const health = await fetchHealthOrThrow();
  const project = await resolveProjectOrThrow();
  const client = new Client(
    { name: "flux-mcp-smoke", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", mcpServerPath()],
    cwd: repoRoot(),
    env: buildSpawnEnv(project.id),
    stderr: "pipe",
  });

  const stderrChunks: string[] = [];
  const stderr = transport.stderr;
  stderr?.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  let createdIssue: CreatedIssue | null = null;

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    if (!toolNames.has("issues_create") || !toolNames.has("issues_close")) {
      throw new Error(
        "MCP server did not expose required tools: expected issues_create and issues_close",
      );
    }

    const createPayload = parseToolPayload(
      await client.callTool({
        name: "issues_create",
        arguments: {
          title: buildSmokeTitle(),
          description: buildSmokeDescription(project, health),
          priority: "low",
        },
      }),
      "issues_create",
    );
    createdIssue = assertIssue(createPayload.issue, "issues_create");

    const closePayload = parseToolPayload(
      await client.callTool({
        name: "issues_close",
        arguments: {
          issueId: createdIssue._id,
          closeType: "noop",
          reason:
            "Temporary smoke issue closed automatically after MCP transport verification.",
        },
      }),
      "issues_close",
    );
    assertIssue(closePayload.issue, "issues_close");

    console.log(`Project: ${project.slug} (${project.id})`);
    console.log(`Health:  ${formatHealthSummary(health)}`);
    console.log(`Created: ${createdIssue.shortId}`);
    console.log(`Closed:  ${createdIssue.shortId}`);
  } catch (error) {
    const stderrText = stderrChunks.join("").trim();
    const suffix = stderrText ? `\n\nMCP stderr:\n${stderrText}` : "";
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${createdIssue ? `\nTemporary issue: ${createdIssue.shortId} (${createdIssue._id})` : ""}${suffix}`,
    );
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
