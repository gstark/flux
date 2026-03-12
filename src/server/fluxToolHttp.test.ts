import { afterAll, describe, expect, test } from "bun:test";
import { callFluxTool } from "./fluxToolHttp";

const servers: Array<{ stop: (closeActiveConnections?: boolean) => void }> = [];

afterAll(() => {
  for (const server of servers) {
    server.stop(true);
  }
});

describe("callFluxTool", () => {
  test("returns timeout diagnostics with daemon health when a tool call stalls", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/projects/proj/tools") {
          return new Promise<Response>(() => {});
        }
        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            version: "test",
            sessions: 1,
            projects: { total: 1, busy: 1, idle: 0 },
            memory: { rss: 42 },
          });
        }
        throw new Error(`Unexpected path: ${url.pathname}`);
      },
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const result = await callFluxTool({
      fluxUrl: baseUrl,
      toolsUrl: `${baseUrl}/api/projects/proj/tools`,
      tool: "issues_create",
      payload: { tool: "issues_create", args: { title: "Test" } },
      headers: { "Content-Type": "application/json" },
      timeoutMs: 50,
    });

    expect(result.isError).toBe(true);
    const first = result.content[0];
    expect(first).toBeDefined();
    const diagnostic = JSON.parse(first?.text ?? "{}") as {
      error: string;
      tool: string;
      timeoutMs: number;
      health: {
        reachable: boolean;
        status?: string;
        projects?: { busy?: number };
      };
    };
    expect(diagnostic.error).toBe("flux_tool_timeout");
    expect(diagnostic.tool).toBe("issues_create");
    expect(diagnostic.timeoutMs).toBe(50);
    expect(diagnostic.health.reachable).toBe(true);
    expect(diagnostic.health.status).toBe("ok");
    expect(diagnostic.health.projects?.busy).toBe(1);
  });

  test("returns HTTP diagnostics with response details", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/projects/proj/tools") {
          return new Response("backend unavailable", { status: 503 });
        }
        if (url.pathname === "/health") {
          return Response.json({
            status: "ok",
            version: "test",
            sessions: 0,
            projects: { total: 1, busy: 0, idle: 1 },
            memory: { rss: 7 },
          });
        }
        throw new Error(`Unexpected path: ${url.pathname}`);
      },
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const result = await callFluxTool({
      fluxUrl: baseUrl,
      toolsUrl: `${baseUrl}/api/projects/proj/tools`,
      tool: "orchestrator_status",
      payload: { tool: "orchestrator_status", args: {} },
      headers: { "Content-Type": "application/json" },
      timeoutMs: 50,
    });

    expect(result.isError).toBe(true);
    const first = result.content[0];
    expect(first).toBeDefined();
    const diagnostic = JSON.parse(first?.text ?? "{}") as {
      error: string;
      status: number;
      responseSnippet: string;
      health: { reachable: boolean };
    };
    expect(diagnostic.error).toBe("flux_tool_http_error");
    expect(diagnostic.status).toBe(503);
    expect(diagnostic.responseSnippet).toContain("backend unavailable");
    expect(diagnostic.health.reachable).toBe(true);
  });
});
