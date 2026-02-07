import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  closeTypeValidator,
  IssuePriority,
  IssueStatus,
  issuePriorityValidator,
  issueStatusValidator,
} from "./schema";

const PRIORITY_ORDER = {
  [IssuePriority.Critical]: 0,
  [IssuePriority.High]: 1,
  [IssuePriority.Medium]: 2,
  [IssuePriority.Low]: 3,
} as const;

function generateShortId(slug: string, counter: number): string {
  return `${slug.toUpperCase()}-${counter}`;
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(issuePriorityValidator),
    sourceIssueId: v.optional(v.id("issues")),
    epicId: v.optional(v.id("epics")),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);

    const counter = project.issueCounter + 1;
    await ctx.db.patch(args.projectId, { issueCounter: counter });

    const issueId = await ctx.db.insert("issues", {
      projectId: args.projectId,
      shortId: generateShortId(project.slug, counter),
      title: args.title,
      description: args.description,
      status: IssueStatus.Open,
      priority: args.priority ?? IssuePriority.Medium,
      assignee: undefined,
      failureCount: 0,
      reviewIterations: 0,
      sourceIssueId: args.sourceIssueId,
      epicId: args.epicId,
      labelIds: args.labelIds,
      updatedAt: Date.now(),
    });

    return issueId;
  },
});

export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(issueStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = args.limit || 100;

    // Collect all then filter — take() before filter would under-count
    // when status or deletedAt filters discard rows.
    const all = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    let issues = all.filter((i) => i.deletedAt === undefined);
    if (args.status) issues = issues.filter((i) => i.status === args.status);

    issues.sort((a, b) => {
      const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return diff !== 0
        ? diff
        : (a._creationTime || 0) - (b._creationTime || 0);
    });

    return issues.slice(0, cap);
  },
});

export const ready = query({
  args: {
    projectId: v.id("projects"),
    maxFailures: v.number(),
  },
  handler: async (ctx, { projectId, maxFailures }) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const candidates = issues.filter(
      (i) =>
        i.status === IssueStatus.Open &&
        i.failureCount < maxFailures &&
        i.deletedAt === undefined,
    );

    // Exclude issues blocked by non-closed dependencies
    const ready = [];
    for (const issue of candidates) {
      const blockerDeps = await ctx.db
        .query("dependencies")
        .withIndex("by_blocked", (q) => q.eq("blockedId", issue._id))
        .collect();

      let blocked = false;
      for (const dep of blockerDeps) {
        const blocker = await ctx.db.get(dep.blockerId);
        if (blocker && blocker.status !== IssueStatus.Closed) {
          blocked = true;
          break;
        }
      }

      if (!blocked) ready.push(issue);
    }

    return ready.sort((a, b) => {
      const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return diff !== 0 ? diff : a._creationTime - b._creationTime;
    });
  },
});

export const get = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.issueId);
  },
});

export const claim = mutation({
  args: {
    issueId: v.id("issues"),
    assignee: v.string(),
  },
  handler: async (ctx, { issueId, assignee }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);
    if (issue.status !== IssueStatus.Open) {
      return { success: false as const, reason: "not_open" };
    }
    await ctx.db.patch(issueId, {
      status: IssueStatus.InProgress,
      assignee,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(issueId);
    return { success: true as const, issue: updated! };
  },
});

export const update = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assignee: v.optional(v.string()),
    sourceIssueId: v.optional(v.id("issues")),
    closeType: v.optional(closeTypeValidator),
    closeReason: v.optional(v.string()),
    epicId: v.optional(v.id("epics")),
    labelIds: v.optional(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error(`Issue ${args.issueId} not found`);

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.status !== undefined) updates.status = args.status;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.assignee !== undefined) updates.assignee = args.assignee;
    if (args.sourceIssueId !== undefined)
      updates.sourceIssueId = args.sourceIssueId;
    if (args.closeType !== undefined) updates.closeType = args.closeType;
    if (args.closeReason !== undefined) updates.closeReason = args.closeReason;
    if (args.epicId !== undefined) updates.epicId = args.epicId;
    if (args.labelIds !== undefined) updates.labelIds = args.labelIds;

    await ctx.db.patch(args.issueId, updates);
    return await ctx.db.get(args.issueId);
  },
});

export const close = mutation({
  args: {
    issueId: v.id("issues"),
    closeType: closeTypeValidator,
    closeReason: v.optional(v.string()),
  },
  handler: async (ctx, { issueId, closeType, closeReason }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);
    // Idempotent: closing an already-closed issue is a no-op.
    // The orchestrator's noop path calls close after the agent may have already
    // closed the issue via MCP during the session. Throwing here would crash
    // the exit handler and wedge the orchestrator in Busy state.
    if (issue.status === IssueStatus.Closed) return issue;

    await ctx.db.patch(issueId, {
      status: IssueStatus.Closed,
      closeType,
      closeReason,
      closedAt: Date.now(),
      assignee: undefined,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(issueId);
  },
});

export const unstick = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);
    if (issue.status !== IssueStatus.Stuck)
      throw new Error(
        `Issue ${issueId} is not stuck (status: ${issue.status})`,
      );

    await ctx.db.patch(issueId, {
      status: IssueStatus.Open,
      failureCount: 0,
      reviewIterations: 0,
      assignee: undefined,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(issueId);
  },
});

export const incrementFailure = mutation({
  args: {
    issueId: v.id("issues"),
    maxFailures: v.number(),
    reopenToOpen: v.optional(v.boolean()),
  },
  handler: async (ctx, { issueId, maxFailures, reopenToOpen }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);

    const newCount = issue.failureCount + 1;
    const updates: Record<string, unknown> = {
      failureCount: newCount,
      updatedAt: Date.now(),
    };

    if (newCount >= maxFailures) {
      updates.status = IssueStatus.Stuck;
      updates.assignee = undefined;
    } else if (reopenToOpen !== false) {
      updates.status = IssueStatus.Open;
      updates.assignee = undefined;
    }

    await ctx.db.patch(issueId, updates);
    return await ctx.db.get(issueId);
  },
});

export const incrementReviewIterations = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);

    const newCount = (issue.reviewIterations ?? 0) + 1;
    await ctx.db.patch(issueId, {
      reviewIterations: newCount,
      updatedAt: Date.now(),
    });
    return newCount;
  },
});

export const search = query({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? 20, 100);

    // Full-text search on title, scoped to project
    const titleMatches = await ctx.db
      .query("issues")
      .withSearchIndex("search_title", (q) =>
        q.search("title", args.query).eq("projectId", args.projectId),
      )
      .take(cap);

    return titleMatches.filter((i) => i.deletedAt === undefined);
  },
});

export const retry = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);

    await ctx.db.patch(issueId, {
      failureCount: 0,
      status: IssueStatus.Open,
      assignee: undefined,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(issueId);
  },
});
