import { describe, expect, test } from "bun:test";
import {
  buildReviewPrompt,
  extractDispositionCandidates,
  parseDisposition,
} from "./prompts";

// ── extractDispositionCandidates ────────────────────────────────────

describe("extractDispositionCandidates", () => {
  test("extracts simple disposition object", () => {
    const text = '{"disposition": "done", "note": "implemented feature"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toEqual([text]);
  });

  test("extracts disposition with curly braces in note (TypeScript generics)", () => {
    const text =
      '{"disposition": "done", "note": "buildPatch<T>(args: T): { [K in keyof T]?: NonNullable<T[K]> }"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string)).toEqual({
      disposition: "done",
      note: "buildPatch<T>(args: T): { [K in keyof T]?: NonNullable<T[K]> }",
    });
  });

  test("extracts disposition with curly braces in note (JSX attributes)", () => {
    const text =
      '{"disposition": "done", "note": "showButton={false} removed from AppShell.tsx"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string)).toEqual({
      disposition: "done",
      note: "showButton={false} removed from AppShell.tsx",
    });
  });

  test("extracts disposition with nested JSON object in note", () => {
    const text =
      '{"disposition": "done", "note": "config changed to {\\"key\\": \\"value\\", \\"nested\\": {\\"a\\": 1}}"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    const parsed = JSON.parse(first as string);
    expect(parsed.disposition).toBe("done");
    expect(parsed.note).toContain("config changed to");
  });

  test("extracts disposition embedded in surrounding text", () => {
    const text =
      'Here is my result: {"disposition": "done", "note": "all good"} end of output';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toEqual(['{"disposition": "done", "note": "all good"}']);
  });

  test("returns empty array when no disposition present", () => {
    const text = "no json here, just plain text";
    expect(extractDispositionCandidates(text)).toEqual([]);
  });

  test("returns empty array for JSON without disposition key", () => {
    const text = '{"status": "ok", "count": 42}';
    expect(extractDispositionCandidates(text)).toEqual([]);
  });

  test("handles multiple disposition-like objects", () => {
    const text =
      '{"disposition": "fault", "note": "first attempt"} some text {"disposition": "done", "note": "fixed"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(2);
    const [first, second] = candidates;
    expect(JSON.parse(first as string).disposition).toBe("fault");
    expect(JSON.parse(second as string).disposition).toBe("done");
  });

  test("handles escaped quotes inside note", () => {
    const text =
      '{"disposition": "done", "note": "set \\"mode\\" to \\"dark\\""}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string).note).toBe('set "mode" to "dark"');
  });

  test("skips unclosed braces gracefully", () => {
    const text = '{ unclosed {"disposition": "done", "note": "ok"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string).disposition).toBe("done");
  });

  test("handles backslash outside string context (markdown)", () => {
    // Markdown might include \{ which should NOT cause the brace to be skipped
    const text =
      'some \\{ markdown {"disposition": "done", "note": "fixed markdown"}';
    const candidates = extractDispositionCandidates(text);
    expect(candidates).toHaveLength(1);
    const first = candidates[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string).disposition).toBe("done");
  });
});

// ── parseDisposition ────────────────────────────────────────────────

describe("parseDisposition", () => {
  describe("happy path dispositions", () => {
    test("parses done disposition", () => {
      const result = parseDisposition([
        '{"disposition": "done", "note": "implemented the feature"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "implemented the feature",
      });
    });

    test("parses noop disposition", () => {
      const result = parseDisposition([
        '{"disposition": "noop", "note": "already fixed in previous commit"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "noop",
        note: "already fixed in previous commit",
      });
    });

    test("parses fault disposition", () => {
      const result = parseDisposition([
        '{"disposition": "fault", "note": "missing API credentials"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "fault",
        note: "missing API credentials",
      });
    });
  });

  describe("notes containing curly braces", () => {
    test("TypeScript generic syntax in note", () => {
      const result = parseDisposition([
        '{"disposition": "done", "note": "buildPatch<T>(args: T): { [K in keyof T]?: NonNullable<T[K]> }"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "buildPatch<T>(args: T): { [K in keyof T]?: NonNullable<T[K]> }",
      });
    });

    test("JSX attribute syntax in note", () => {
      const result = parseDisposition([
        '{"disposition": "done", "note": "showButton={false} removed from AppShell.tsx"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "showButton={false} removed from AppShell.tsx",
      });
    });

    test("JSON snippet in note", () => {
      const result = parseDisposition([
        '{"disposition": "done", "note": "config: {\\"host\\": \\"localhost\\", \\"port\\": 3000}"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: 'config: {"host": "localhost", "port": 3000}',
      });
    });

    test("deeply nested braces in note", () => {
      const result = parseDisposition([
        '{"disposition": "done", "note": "type Foo = { bar: { baz: { qux: string } } }"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "type Foo = { bar: { baz: { qux: string } } }",
      });
    });
  });

  describe("disposition in NDJSON stream envelope", () => {
    test("extracts from content_block_delta text_delta", () => {
      const envelope = JSON.stringify({
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: '{"disposition": "done", "note": "completed via stream"}',
        },
      });
      const result = parseDisposition([envelope]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "completed via stream",
      });
    });

    test("extracts from assistant message envelope", () => {
      const envelope = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: '{"disposition": "done", "note": "from assistant envelope"}',
            },
          ],
        },
      });
      const result = parseDisposition([envelope]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "from assistant envelope",
      });
    });

    test("extracts from result envelope", () => {
      const envelope = JSON.stringify({
        type: "result",
        result: [
          {
            type: "text",
            text: '{"disposition": "noop", "note": "from result"}',
          },
        ],
      });
      const result = parseDisposition([envelope]);
      expect(result).toEqual({
        success: true,
        disposition: "noop",
        note: "from result",
      });
    });

    test("extracts from envelope with curly braces in note (production failure scenario)", () => {
      const envelope = JSON.stringify({
        type: "content_block_delta",
        delta: {
          type: "text_delta",
          text: '{"disposition": "done", "note": "showButton={false} removed from AppShell.tsx"}',
        },
      });
      const result = parseDisposition([envelope]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "showButton={false} removed from AppShell.tsx",
      });
    });
  });

  describe("disposition in markdown code blocks", () => {
    test("extracts disposition from json code block", () => {
      const result = parseDisposition([
        "```json",
        '{"disposition": "done", "note": "in a code block"}',
        "```",
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "in a code block",
      });
    });

    test("extracts disposition from unmarked code block", () => {
      const result = parseDisposition([
        "```",
        '{"disposition": "done", "note": "in an unmarked block"}',
        "```",
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "in an unmarked block",
      });
    });
  });

  describe("malformed or missing dispositions", () => {
    test("returns failure for empty lines", () => {
      const result = parseDisposition([]);
      expect(result).toEqual({
        success: false,
        error: "No valid disposition JSON found in last 0 lines of output",
      });
    });

    test("returns failure for lines with no JSON", () => {
      const result = parseDisposition([
        "Just some text",
        "No JSON here",
        "Nothing at all",
      ]);
      expect(result.success).toBe(false);
    });

    test("returns failure for JSON without disposition key", () => {
      const result = parseDisposition([
        '{"status": "ok", "message": "not a disposition"}',
      ]);
      expect(result.success).toBe(false);
    });

    test("returns failure for invalid disposition value", () => {
      const result = parseDisposition([
        '{"disposition": "invalid", "note": "bad value"}',
      ]);
      expect(result.success).toBe(false);
    });

    test("returns failure for disposition without note", () => {
      const result = parseDisposition(['{"disposition": "done"}']);
      expect(result.success).toBe(false);
    });

    test("returns failure for note that is not a string", () => {
      const result = parseDisposition(['{"disposition": "done", "note": 42}']);
      expect(result.success).toBe(false);
    });
  });

  describe("multiple disposition-like objects", () => {
    test("picks the last valid disposition across lines", () => {
      const result = parseDisposition([
        '{"disposition": "fault", "note": "first attempt failed"}',
        "some other output",
        '{"disposition": "done", "note": "retried and succeeded"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "retried and succeeded",
      });
    });

    test("picks the last valid disposition within a single line", () => {
      const result = parseDisposition([
        '{"disposition": "fault", "note": "attempt 1"} and then {"disposition": "done", "note": "attempt 2"}',
      ]);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "attempt 2",
      });
    });
  });

  describe("scanning behavior", () => {
    test("scans backward from end of output", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
      lines[95] = '{"disposition": "done", "note": "near the end"}';
      const result = parseDisposition(lines);
      expect(result).toEqual({
        success: true,
        disposition: "done",
        note: "near the end",
      });
    });

    test("does not find disposition beyond 50-line scan window", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
      lines[10] = '{"disposition": "done", "note": "too far back"}';
      const result = parseDisposition(lines);
      expect(result.success).toBe(false);
    });
  });
});

// ── buildReviewPrompt ───────────────────────────────────────────────

describe("buildReviewPrompt", () => {
  test("includes previous review context when provided", () => {
    const prompt = buildReviewPrompt({
      shortId: "FLUX-100",
      title: "Test Issue",
      description: "Test description",
      diff: "diff content",
      commitLog: "commit log",
      relatedIssues: [],
      reviewIteration: 3,
      maxReviewIterations: 10,
      previousReviews: [
        {
          iteration: 1,
          disposition: "done",
          note: "Found 3 issues: missing error handling, no validation, console.log left in code",
          createdIssues: [
            { shortId: "FLUX-101", title: "Add error handling" },
            { shortId: "FLUX-102", title: "Add validation" },
          ],
          commitLog: "abc123 Fix console.log\ndef456 Update types",
        },
        {
          iteration: 2,
          disposition: "done",
          note: "Verified previous fixes, found race condition",
          createdIssues: [],
          commitLog: "ghi789 Fix race condition",
        },
      ],
    });

    expect(prompt).toContain("## Previous Review Iterations");
    expect(prompt).toContain("### Review 1");
    expect(prompt).toContain("- Disposition: done");
    expect(prompt).toContain(
      '- Note: "Found 3 issues: missing error handling, no validation, console.log left in code"',
    );
    expect(prompt).toContain(
      "- Created issues: FLUX-101: Add error handling, FLUX-102: Add validation",
    );
    expect(prompt).toContain("abc123 Fix console.log");
    expect(prompt).toContain("### Review 2");
    expect(prompt).toContain("- Created issues: (none)");
    expect(prompt).toContain("ghi789 Fix race condition");
  });

  test("shows fallback message when reviewIteration > 1 but no previousReviews", () => {
    const prompt = buildReviewPrompt({
      shortId: "FLUX-100",
      title: "Test Issue",
      diff: "diff content",
      commitLog: "commit log",
      relatedIssues: [],
      reviewIteration: 2,
      maxReviewIterations: 10,
    });

    expect(prompt).toContain(
      "Previous reviews found issues that were fixed inline",
    );
    expect(prompt).not.toContain("## Previous Review Iterations");
  });

  test("no previous review context when reviewIteration is 1", () => {
    const prompt = buildReviewPrompt({
      shortId: "FLUX-100",
      title: "Test Issue",
      diff: "diff content",
      commitLog: "commit log",
      relatedIssues: [],
      reviewIteration: 1,
      maxReviewIterations: 10,
    });

    expect(prompt).not.toContain("Previous reviews");
    expect(prompt).not.toContain("## Previous Review Iterations");
  });

  test("shows commit log error when retrieval fails", () => {
    const prompt = buildReviewPrompt({
      shortId: "FLUX-100",
      title: "Test Issue",
      diff: "diff content",
      commitLog: "commit log",
      relatedIssues: [],
      reviewIteration: 2,
      maxReviewIterations: 10,
      previousReviews: [
        {
          iteration: 1,
          disposition: "done",
          note: "Fixed issue",
          createdIssues: [],
          commitLogError: "Failed to retrieve commit log: invalid revision",
        },
      ],
    });

    expect(prompt).toContain("## Previous Review Iterations");
    expect(prompt).toContain("### Review 1");
    expect(prompt).toContain(
      "- Commits: (Failed to retrieve commit log: invalid revision)",
    );
  });
});
