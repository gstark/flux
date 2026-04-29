import { describe, expect, test } from "bun:test";
import { groupTranscriptEvents } from "./groupTranscriptEvents";

function outputEvent(
  sequence: number,
  timestamp: number,
  content: Record<string, unknown>,
) {
  return {
    _id: `event-${sequence}`,
    direction: "output",
    sequence,
    timestamp,
    content: JSON.stringify(content),
  };
}

describe("groupTranscriptEvents for pi", () => {
  test("pairs tool_execution events with later turn_end toolCall summaries", () => {
    const toolCallId = "call_pi_test_123";

    const nodes = groupTranscriptEvents(
      [
        outputEvent(1, 1000, {
          type: "tool_execution_start",
          toolCallId,
          toolName: "bash",
          args: { command: "echo hi" },
        }),
        outputEvent(2, 1001, {
          type: "tool_execution_end",
          toolCallId,
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "hi" }],
            isError: false,
          },
        }),
        outputEvent(3, 1002, {
          type: "turn_end",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "Done.",
              },
              {
                type: "toolCall",
                id: toolCallId,
                name: "bash",
                arguments: { command: "echo hi" },
              },
            ],
          },
        }),
      ],
      "pi",
    );

    const toolNodes = nodes.filter((node) => node.type === "tool_call");
    expect(toolNodes).toHaveLength(1);
    expect(toolNodes[0]?.pair.toolUse.toolName).toBe("Bash");
    expect(toolNodes[0]?.pair.toolUse.toolInput).toEqual({ command: "echo hi" });
    expect(toolNodes[0]?.pair.toolResult?.content).toBe("hi");

    const textNodes = nodes.filter((node) => node.type === "text");
    expect(textNodes).toHaveLength(1);
    expect(textNodes[0]?.parsed.text).toBe("Done.");
  });
});
