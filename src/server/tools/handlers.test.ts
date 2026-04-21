import { describe, expect, mock, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import type { Id } from "$convex/_generated/dataModel";
import { handlers, type ToolContext } from "./index";

function makeContext() {
  const query = mock(async (_fn: unknown, args: Record<string, unknown>) => {
    if (args.shortId === "LUCKYDO-221") {
      return {
        _id: "issues_doc_221" as Id<"issues">,
        shortId: "LUCKYDO-221",
        title: "Issue 221",
      };
    }

    if (args.shortId === "LUCKYDO-999") {
      return null;
    }

    if (args.issueId === ("issues_doc_221" as Id<"issues">)) {
      if (args.limit === 50) {
        return [
          {
            _id: "comment_1",
            issueId: "issues_doc_221",
            content: "Resolved through short ID",
            author: "agent",
            createdAt: 1,
          },
        ];
      }

      return {
        _id: "issues_doc_221" as Id<"issues">,
        shortId: "LUCKYDO-221",
        title: "Issue 221",
      };
    }

    throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
  });

  const mutation = mock(async (_fn: unknown, args: Record<string, unknown>) => {
    if (args.issueId === ("issues_doc_221" as Id<"issues">)) {
      return "comment_1";
    }
    throw new Error(`Unexpected mutation args: ${JSON.stringify(args)}`);
  });

  const ctx: ToolContext = {
    convex: { query, mutation } as unknown as ConvexClient,
    projectId: "project_1" as Id<"projects">,
    projectSlug: "luckydo",
    getRunner: () => undefined,
  };

  return { ctx, query, mutation };
}

describe("comment tools short ID resolution", () => {
  test("comments_create resolves a short issue ID before mutation", async () => {
    const { ctx, query, mutation } = makeContext();
    const commentsCreate = handlers.comments_create;
    expect(commentsCreate).toBeDefined();
    if (!commentsCreate) {
      throw new Error("comments_create handler is not defined");
    }

    const result = await commentsCreate(
      {
        issueId: "luckydo-221",
        content: "Resolved through short ID",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shortId: "LUCKYDO-221",
      }),
    );
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issueId: "issues_doc_221",
        content: "Resolved through short ID",
        author: undefined,
      }),
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      commentId: string;
    };
    expect(payload.commentId).toBe("comment_1");
  });

  test("comments_list resolves a short issue ID before query", async () => {
    const { ctx, query, mutation } = makeContext();
    const commentsList = handlers.comments_list;
    expect(commentsList).toBeDefined();
    if (!commentsList) {
      throw new Error("comments_list handler is not defined");
    }

    const result = await commentsList(
      {
        issueId: "LUCKYDO-221",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(0);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        shortId: "LUCKYDO-221",
      }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        issueId: "issues_doc_221",
        limit: 50,
      }),
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      comments: Array<{ content: string }>;
      count: number;
    };
    expect(payload.count).toBe(1);
    expect(payload.comments[0]?.content).toBe("Resolved through short ID");
  });
});

describe("issues_get short ID resolution", () => {
  test("issues_get resolves a short issue ID before query", async () => {
    const { ctx, query, mutation } = makeContext();
    const issuesGet = handlers.issues_get;
    expect(issuesGet).toBeDefined();
    if (!issuesGet) {
      throw new Error("issues_get handler is not defined");
    }

    const result = await issuesGet(
      {
        issueId: "LUCKYDO-221",
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(0);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        shortId: "LUCKYDO-221",
      }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        issueId: "issues_doc_221",
      }),
    );
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      issue: { _id: string; shortId: string; title: string };
    };
    expect(payload.issue._id).toBe("issues_doc_221");
    expect(payload.issue.shortId).toBe("LUCKYDO-221");
    expect(payload.issue.title).toBe("Issue 221");
  });

  test("issues_get returns a guided lookup error for unknown short IDs", async () => {
    const { ctx, query, mutation } = makeContext();
    const issuesGet = handlers.issues_get;
    expect(issuesGet).toBeDefined();
    if (!issuesGet) {
      throw new Error("issues_get handler is not defined");
    }

    const result = await issuesGet(
      {
        issueId: "LUCKYDO-999",
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(0);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      error: string;
    };
    expect(payload.error).toBe(
      "Issue not found for short ID LUCKYDO-999. Use issues_search to confirm the issue exists.",
    );
  });
});

describe("follow-up issue epic inheritance", () => {
  test("issues_create inherits epicId from the source issue when omitted", async () => {
    const sourceIssueId = "issues_source_1" as Id<"issues">;
    const inheritedEpicId = "epics_doc_1" as Id<"epics">;
    const createdIssueId = "issues_created_1" as Id<"issues">;

    const query = mock(async (_fn: unknown, args: Record<string, unknown>) => {
      if (args.issueId === sourceIssueId) {
        return {
          _id: sourceIssueId,
          shortId: "LUCKYDO-42",
          title: "Source issue",
          epicId: inheritedEpicId,
        };
      }

      if (args.issueId === createdIssueId) {
        return {
          _id: createdIssueId,
          shortId: "LUCKYDO-43",
          title: "Follow-up issue",
          epicId: inheritedEpicId,
        };
      }

      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });

    const mutation = mock(async (_fn: unknown, args: Record<string, unknown>) => {
      expect(args).toEqual(
        expect.objectContaining({
          projectId: "project_1",
          title: "Follow-up issue",
          epicId: inheritedEpicId,
          sourceIssueId,
        }),
      );
      return createdIssueId;
    });

    const ctx: ToolContext = {
      convex: { query, mutation } as unknown as ConvexClient,
      projectId: "project_1" as Id<"projects">,
      projectSlug: "luckydo",
      getRunner: () => undefined,
      issueId: sourceIssueId,
    };

    const issuesCreate = handlers.issues_create;
    expect(issuesCreate).toBeDefined();
    if (!issuesCreate) {
      throw new Error("issues_create handler is not defined");
    }

    const result = await issuesCreate({ title: "Follow-up issue" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  test("issues_bulk_create inherits epicId from the source issue when omitted", async () => {
    const sourceIssueId = "issues_source_1" as Id<"issues">;
    const inheritedEpicId = "epics_doc_1" as Id<"epics">;

    const query = mock(async (_fn: unknown, args: Record<string, unknown>) => {
      if (args.issueId === sourceIssueId) {
        return {
          _id: sourceIssueId,
          shortId: "LUCKYDO-42",
          title: "Source issue",
          epicId: inheritedEpicId,
        };
      }

      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });

    const mutation = mock(async (_fn: unknown, args: Record<string, unknown>) => {
      expect(args).toEqual(
        expect.objectContaining({
          projectId: "project_1",
          issues: [
            expect.objectContaining({
              title: "Follow-up 1",
              epicId: inheritedEpicId,
              sourceIssueId,
            }),
            expect.objectContaining({
              title: "Follow-up 2",
              epicId: inheritedEpicId,
              sourceIssueId,
            }),
          ],
        }),
      );
      return [
        {
          _id: "issues_created_1",
          shortId: "LUCKYDO-43",
          title: "Follow-up 1",
          epicId: inheritedEpicId,
        },
        {
          _id: "issues_created_2",
          shortId: "LUCKYDO-44",
          title: "Follow-up 2",
          epicId: inheritedEpicId,
        },
      ];
    });

    const ctx: ToolContext = {
      convex: { query, mutation } as unknown as ConvexClient,
      projectId: "project_1" as Id<"projects">,
      projectSlug: "luckydo",
      getRunner: () => undefined,
      issueId: sourceIssueId,
    };

    const issuesBulkCreate = handlers.issues_bulk_create;
    expect(issuesBulkCreate).toBeDefined();
    if (!issuesBulkCreate) {
      throw new Error("issues_bulk_create handler is not defined");
    }

    const result = await issuesBulkCreate(
      {
        issues: [{ title: "Follow-up 1" }, { title: "Follow-up 2" }],
      },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
