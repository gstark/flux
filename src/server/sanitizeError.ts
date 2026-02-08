/**
 * Sanitize Convex error messages for external API consumption.
 *
 * Convex errors arrive in a verbose format:
 *   [CONVEX M(module:fn)] [Request ID: xxx] Server Error
 *   Uncaught Error: Human-readable message
 *       at handler (../convex/module.ts:42:10)
 *
 * This extracts just the human-readable message, stripping:
 * - The `[CONVEX ...]` function prefix
 * - The `[Request ID: ...]` metadata
 * - Error class prefixes like "Uncaught Error: "
 * - Stack trace lines
 */
export function sanitizeConvexError(message: string): string {
  // Not a Convex error — return as-is
  if (!message.startsWith("[CONVEX")) {
    return message;
  }

  // Strip stack trace: everything from "\n    at " onward
  const withoutStack = message.replace(/\n\s+at .*/g, "");

  // Remove the [CONVEX ...] prefix(es) and [Request ID: ...] blocks
  const withoutBrackets = withoutStack.replace(/\[.*?\]\s*/g, "");

  // The remainder looks like: "Server Error\nUncaught Error: Human message"
  // Split on newlines and take the last non-empty line — that's the actual error.
  const lines = withoutBrackets.split("\n").filter((l) => l.trim());
  const lastLine = lines.at(-1)?.trim() ?? message;

  // Strip common error class prefixes: "Uncaught Error: ", "TypeError: ", etc.
  const cleaned = lastLine.replace(/^(?:Uncaught\s+)?(?:\w*Error):\s*/, "");

  return cleaned || message;
}
