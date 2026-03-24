import { describe, expect, test } from "bun:test";
import {
  buildRetroPrompt,
  buildReviewPrompt,
  buildWorkPrompt,
} from "./prompts";
import type {
  RetroPromptContext,
  ReviewPromptContext,
  WorkPromptContext,
} from "./types";

describe("Custom prompt injection", () => {
  describe("buildWorkPrompt", () => {
    test("uses custom prompt when provided", () => {
      const ctx: WorkPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        description: "Test description",
        customPrompt: "Custom work prompt: {{ISSUE}}",
      };

      const result = buildWorkPrompt(ctx);

      expect(result).toContain("Custom work prompt:");
      expect(result).toContain("### FLUX-123: Test issue");
      expect(result).toContain("Test description");
      expect(result).not.toContain("{{ISSUE}}");
    });

    test("injects issue with comments", () => {
      const ctx: WorkPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        description: "Test description",
        comments: [
          { author: "user", content: "First comment" },
          { author: "agent", content: "Second comment" },
        ],
        customPrompt: "Issue:\n{{ISSUE}}",
      };

      const result = buildWorkPrompt(ctx);

      expect(result).toContain("[user]: First comment");
      expect(result).toContain("[agent]: Second comment");
    });

    test("uses default prompt when custom prompt not provided", () => {
      const ctx: WorkPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
      };

      const result = buildWorkPrompt(ctx);

      expect(result).toContain("You are a Flux autonomous agent");
      expect(result).toContain("### FLUX-123: Test issue");
    });
  });

  describe("buildRetroPrompt", () => {
    test("uses custom prompt when provided", () => {
      const ctx: RetroPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        workNote: "Completed successfully",
        customPrompt:
          "Retro for {{SHORT_ID}}\nWork note: {{WORK_NOTE}}\nReflect.",
      };

      const result = buildRetroPrompt(ctx);

      expect(result).toContain("Retro for FLUX-123");
      expect(result).toContain("Work note: Completed successfully");
      expect(result).toContain("Reflect.");
      expect(result).not.toContain("{{SHORT_ID}}");
      expect(result).not.toContain("{{WORK_NOTE}}");
    });

    test("handles missing work note", () => {
      const ctx: RetroPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        customPrompt: "Note: {{WORK_NOTE}}",
      };

      const result = buildRetroPrompt(ctx);

      expect(result).toContain("Note: (no summary provided)");
    });

    test("uses default prompt when custom prompt not provided", () => {
      const ctx: RetroPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
      };

      const result = buildRetroPrompt(ctx);

      expect(result).toContain("## Retrospective: FLUX-123");
    });
  });

  describe("buildReviewPrompt", () => {
    test("uses custom prompt when provided", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        description: "Test description",
        diff: "diff content",
        commitLog: "commit log",
        relatedIssues: [
          { shortId: "FLUX-100", title: "Related", status: "open" },
        ],
        reviewIteration: 1,
        maxReviewIterations: 3,
        customPrompt:
          "Review {{SHORT_ID}}: {{TITLE}}\n\nDiff:\n{{DIFF}}\n\nCommits:\n{{COMMIT_LOG}}\n\nIteration {{REVIEW_ITERATION}}/{{MAX_REVIEW_ITERATIONS}}\n\nRelated:\n{{RELATED_ISSUES}}",
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("Review FLUX-123: Test issue");
      expect(result).toContain("Diff:\ndiff content");
      expect(result).toContain("Commits:\ncommit log");
      expect(result).toContain("Iteration 1/3");
      expect(result).toContain("- FLUX-100: Related [open]");
      expect(result).not.toContain("{{SHORT_ID}}");
      expect(result).not.toContain("{{DIFF}}");
    });

    test("injects comments via {{COMMENTS}} placeholder", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        comments: [
          { author: "user", content: "Please check edge cases" },
          { author: "agent", content: "Will do" },
        ],
        reviewIteration: 1,
        maxReviewIterations: 3,
        customPrompt: "Review {{SHORT_ID}}\n\nComments:\n{{COMMENTS}}",
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("[user]: Please check edge cases");
      expect(result).toContain("[agent]: Will do");
      expect(result).not.toContain("{{COMMENTS}}");
    });

    test("handles empty comments in custom prompt", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        reviewIteration: 1,
        maxReviewIterations: 3,
        customPrompt: "Comments: {{COMMENTS}}",
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("Comments: (none)");
    });

    test("handles empty related issues", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        reviewIteration: 1,
        maxReviewIterations: 3,
        customPrompt: "Related: {{RELATED_ISSUES}}",
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("Related: (none)");
    });

    test("includes comments in default prompt", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        comments: [
          { author: "user", content: "Important context" },
        ],
        reviewIteration: 1,
        maxReviewIterations: 3,
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("## Issue Comments");
      expect(result).toContain("[user]: Important context");
    });

    test("omits comments section in default prompt when no comments", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        reviewIteration: 1,
        maxReviewIterations: 3,
      };

      const result = buildReviewPrompt(ctx);

      expect(result).not.toContain("## Issue Comments");
    });

    test("uses default prompt when custom prompt not provided", () => {
      const ctx: ReviewPromptContext = {
        shortId: "FLUX-123",
        title: "Test issue",
        diff: "diff",
        commitLog: "log",
        relatedIssues: [],
        reviewIteration: 1,
        maxReviewIterations: 3,
      };

      const result = buildReviewPrompt(ctx);

      expect(result).toContain("You are a Flux code review agent");
    });
  });
});
