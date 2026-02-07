import { handlers, type ToolContext } from "./tools";

export function createApiHandler(ctx: ToolContext) {
  return async function handleApi(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json(
        { error: "Method not allowed. Use POST." },
        { status: 405 },
      );
    }

    const body = (await req.json()) as {
      tool?: string;
      args?: Record<string, unknown>;
    };
    const { tool, args } = body;

    if (!tool || typeof tool !== "string") {
      return Response.json(
        {
          content: [
            { type: "text", text: "Missing 'tool' field in request body." },
          ],
          isError: true,
        },
        { status: 400 },
      );
    }

    const handler = handlers[tool];
    if (!handler) {
      return Response.json({
        content: [{ type: "text", text: `Not implemented: ${tool}` }],
        isError: true,
      });
    }

    try {
      const result = await handler(args ?? {}, ctx);
      return Response.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({
        content: [{ type: "text", text: message }],
        isError: true,
      });
    }
  };
}
