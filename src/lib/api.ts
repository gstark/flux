/**
 * Typed wrapper for the Flux server tool API.
 * All tool invocations from the frontend go through here.
 */

export type ToolResponse<T = unknown> = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  /** Parsed payload — only present when isError is falsy. */
  data?: T;
};

/**
 * Call a server-side tool via POST /api/tools.
 * Parses the JSON text payload and returns the typed data.
 * Throws on network errors or when the tool returns isError.
 */
export async function callTool<T = unknown>(
  tool: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });

  if (!res.ok) {
    throw new Error(`Tool call failed: ${res.status} ${res.statusText}`);
  }

  const result = (await res.json()) as ToolResponse;

  if (result.isError) {
    const msg = result.content?.[0]?.text ?? "Unknown tool error";
    throw new Error(msg);
  }

  // The tool handler wraps data as JSON in content[0].text
  const text = result.content?.[0]?.text;
  if (!text) {
    throw new Error("Tool returned empty response");
  }

  return JSON.parse(text) as T;
}
