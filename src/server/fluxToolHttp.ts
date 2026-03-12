export type FluxToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

type FluxHealthSummary = {
  reachable: boolean;
  httpStatus?: number;
  status?: string;
  version?: string;
  sessions?: number;
  projects?: { total?: number; busy?: number; idle?: number };
  memoryMb?: number;
  error?: string;
  bodySnippet?: string;
};

type FluxToolDiagnostic = {
  error:
    | "flux_tool_timeout"
    | "flux_tool_transport_error"
    | "flux_tool_http_error";
  tool: string;
  fluxUrl: string;
  toolsUrl: string;
  elapsedMs: number;
  timeoutMs: number;
  status?: number;
  statusText?: string;
  responseSnippet?: string;
  cause?: string;
  health: FluxHealthSummary;
};

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_000;
const BODY_SNIPPET_LIMIT = 400;

function truncateSnippet(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= BODY_SNIPPET_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, BODY_SNIPPET_LIMIT)}...`;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

async function probeFluxHealth(fluxUrl: string): Promise<FluxHealthSummary> {
  try {
    const response = await fetch(`${fluxUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      const bodyText = await response.text();
      return {
        reachable: false,
        httpStatus: response.status,
        error: `health probe returned ${response.status} ${response.statusText}`,
        bodySnippet: truncateSnippet(bodyText),
      };
    }

    const body = (await response.json()) as {
      status?: string;
      version?: string;
      sessions?: number;
      projects?: { total?: number; busy?: number; idle?: number };
      memory?: { rss?: number };
    };

    return {
      reachable: true,
      httpStatus: response.status,
      status: body.status,
      version: body.version,
      sessions: body.sessions,
      projects: body.projects,
      memoryMb: body.memory?.rss,
    };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function diagnosticResult(diagnostic: FluxToolDiagnostic): FluxToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(diagnostic) }],
    isError: true,
  };
}

export async function callFluxTool(args: {
  fluxUrl: string;
  toolsUrl: string;
  tool: string;
  payload: unknown;
  headers: Record<string, string>;
  timeoutMs?: number;
}): Promise<FluxToolResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    const response = await fetch(args.toolsUrl, {
      method: "POST",
      headers: args.headers,
      body: JSON.stringify(args.payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const health = await probeFluxHealth(args.fluxUrl);
      return diagnosticResult({
        error: "flux_tool_http_error",
        tool: args.tool,
        fluxUrl: args.fluxUrl,
        toolsUrl: args.toolsUrl,
        elapsedMs: Date.now() - startedAt,
        timeoutMs,
        status: response.status,
        statusText: response.statusText,
        responseSnippet: truncateSnippet(await response.text()),
        health,
      });
    }

    return (await response.json()) as FluxToolResult;
  } catch (err) {
    const health = await probeFluxHealth(args.fluxUrl);
    return diagnosticResult({
      error: isTimeoutError(err)
        ? "flux_tool_timeout"
        : "flux_tool_transport_error",
      tool: args.tool,
      fluxUrl: args.fluxUrl,
      toolsUrl: args.toolsUrl,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      cause: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      health,
    });
  }
}
