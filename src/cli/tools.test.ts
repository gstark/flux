import { afterEach, describe, expect, test } from "bun:test";
import { buildProjectUrl, buildToolHeaders, isToolCommand } from "./tools";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("CLI top-level commands", () => {
  test("recognizes flux open as a CLI command", () => {
    expect(isToolCommand(["open"])).toBe(true);
  });

  test("builds the project issues URL for the current Flux host", () => {
    expect(new URL(buildProjectUrl("my-project")).pathname).toBe(
      "/p/my-project/issues",
    );
  });

  test("forwards session context headers when invoked inside an agent session", () => {
    process.env.FLUX_SESSION_ID = "session_123";
    process.env.FLUX_AGENT_NAME = "pi-review";
    process.env.FLUX_ISSUE_ID = "issue_456";

    expect(buildToolHeaders()).toEqual({
      "Content-Type": "application/json",
      "X-Flux-Session-Id": "session_123",
      "X-Flux-Agent-Name": "pi-review",
      "X-Flux-Issue-Id": "issue_456",
    });
  });
});
