import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { allTools, handlers, type ToolContext } from "./tools";

type Session = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
};

/** Sessions keyed by `${projectId}:${mcpSessionId}` to prevent cross-project collisions. */
const sessions = new Map<string, Session>();

function sessionKey(projectId: string, mcpSessionId: string): string {
  return `${projectId}:${mcpSessionId}`;
}

// Schema validation flow inside mcp.tool():
// The raw Zod shapes we pass are transformed by the MCP SDK before reaching our handler:
//   1. getZodSchemaObject() wraps the shape into z.object() if it isn't one already
//   2. normalizeObjectSchema() ensures the schema is a proper Zod object (handles raw shapes, v3/v4)
//   3. toJsonSchemaCompat() converts to JSON Schema (different codepaths for Zod v3 vs v4)
//   4. validateToolInput() runs safeParseAsync() on incoming args BEFORE calling our handler
// So tool.schema is never used raw — the SDK validates and coerces args for us.
// See: sdk/server/mcp.js, sdk/server/zod-compat.js, sdk/server/zod-json-schema-compat.js
function registerTools(mcp: McpServer, ctx: ToolContext) {
  for (const tool of allTools) {
    const handler = handlers[tool.name];

    if (handler) {
      // Implemented — delegate to shared handler
      mcp.tool(tool.name, tool.description, tool.schema, async (args) => {
        return handler(args as Record<string, unknown>, ctx);
      });
    } else {
      // Stub — return "not implemented" for tools without handlers yet
      mcp.tool(tool.name, tool.description, tool.schema, async () => {
        return {
          content: [
            { type: "text" as const, text: `Not implemented: ${tool.name}` },
          ],
          isError: true,
        };
      });
    }
  }
}

/**
 * Handle an MCP request scoped to a specific project.
 *
 * Sessions are keyed by (projectId, mcp-session-id) so two projects
 * can never share a session, even if UUIDs theoretically collide.
 */
export async function handleMcpRequest(
  req: Request,
  ctx: ToolContext,
): Promise<Response> {
  const mcpSessionId = req.headers.get("mcp-session-id");

  // Existing session — route to its transport
  if (mcpSessionId) {
    const key = sessionKey(ctx.projectId, mcpSessionId);
    const session = sessions.get(key);
    if (!session) {
      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Session not found. Send an initialize request to start a new session.",
          },
          id: null,
        },
        { status: 400 },
      );
    }

    if (req.method === "DELETE") {
      await session.server.close();
      sessions.delete(key);
      return new Response(null, { status: 204 });
    }

    return session.transport.handleRequest(req);
  }

  // New session — create server + transport, handle initialize
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  });

  const mcp = new McpServer({ name: "flux", version: "0.1.0" });
  registerTools(mcp, ctx);
  await mcp.connect(transport);

  const response = await transport.handleRequest(req);

  // Store session for subsequent requests, keyed by project
  if (transport.sessionId) {
    const key = sessionKey(ctx.projectId, transport.sessionId);
    sessions.set(key, { transport, server: mcp });
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(sessionKey(ctx.projectId, transport.sessionId));
      }
    };
  }

  return response;
}
