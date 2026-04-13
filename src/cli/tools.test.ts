import { describe, expect, test } from "bun:test";
import { buildProjectUrl, isToolCommand } from "./tools";

describe("CLI top-level commands", () => {
  test("recognizes flux open as a CLI command", () => {
    expect(isToolCommand(["open"])).toBe(true);
  });

  test("builds the project issues URL for the current Flux host", () => {
    expect(buildProjectUrl("my-project")).toBe(
      "http://localhost:8042/p/my-project/issues",
    );
  });
});
