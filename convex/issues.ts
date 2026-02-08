import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

/** Fetch an issue by ID, throwing if it doesn't exist or is soft-deleted. */
async function getActiveIssue(ctx: MutationCtx, issueId: Id<"issues">) {
  const issue = await ctx.db.get(issueId);
  if (!issue) throw new Error(`Issue ${issueId} not found`);
  if (issue.deletedAt !== undefined)
    throw new Error(`Issue ${issueId} is deleted`);
  return issue;
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

export const bulkCreate = mutation({
  args: {
    projectId: v.id("projects"),
    issues: v.array(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        priority: v.optional(issuePriorityValidator),
        sourceIssueId: v.optional(v.id("issues")),
        epicId: v.optional(v.id("epics")),
        labelIds: v.optional(v.array(v.id("labels"))),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);

    let counter = project.issueCounter;
    const now = Date.now();
    const created = [];

    for (const issue of args.issues) {
      counter += 1;
      const issueId = await ctx.db.insert("issues", {
        projectId: args.projectId,
        shortId: generateShortId(project.slug, counter),
        title: issue.title,
        description: issue.description,
        status: IssueStatus.Open,
        priority: issue.priority ?? IssuePriority.Medium,
        assignee: undefined,
        failureCount: 0,
        reviewIterations: 0,
        sourceIssueId: issue.sourceIssueId,
        epicId: issue.epicId,
        labelIds: issue.labelIds,
        updatedAt: now,
      });
      const doc = await ctx.db.get(issueId);
      if (!doc)
        throw new Error(`Failed to read back issue ${issueId} after insert`);
      created.push(doc);
    }

    await ctx.db.patch(args.projectId, { issueCounter: counter });

    return created;
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

    // Compound index eliminates in-memory deletedAt/status filtering
    const { status } = args;
    const issues = status
      ? await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("deletedAt", undefined)
              .eq("status", status),
          )
          .collect()
      : await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", args.projectId).eq("deletedAt", undefined),
          )
          .collect();

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
    // Compound index narrows to non-deleted, open issues; failureCount filtered in-memory
    const openIssues = await ctx.db
      .query("issues")
      .withIndex("by_project_deletedAt_status", (q) =>
        q
          .eq("projectId", projectId)
          .eq("deletedAt", undefined)
          .eq("status", IssueStatus.Open),
      )
      .collect();

    const candidates = openIssues.filter((i) => i.failureCount < maxFailures);

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
    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.deletedAt !== undefined) return null;
    return issue;
  },
});

export const claim = mutation({
  args: {
    issueId: v.id("issues"),
    assignee: v.string(),
  },
  handler: async (ctx, { issueId, assignee }) => {
    const issue = await getActiveIssue(ctx, issueId);
    if (issue.status !== IssueStatus.Open) {
      return { success: false as const, reason: "not_open" };
    }
    await ctx.db.patch(issueId, {
      status: IssueStatus.InProgress,
      assignee,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${issueId} after claim`);
    return { success: true as const, issue: updated };
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
    await getActiveIssue(ctx, args.issueId);

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
    const updated = await ctx.db.get(args.issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${args.issueId} after update`);
    return updated;
  },
});

export const close = mutation({
  args: {
    issueId: v.id("issues"),
    closeType: closeTypeValidator,
    closeReason: v.optional(v.string()),
  },
  handler: async (ctx, { issueId, closeType, closeReason }) => {
    const issue = await getActiveIssue(ctx, issueId);
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
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${issueId} after close`);
    return updated;
  },
});

/** @deprecated Use `retry` instead. Alias kept for UI callsites. */
export const unstick = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    return await retryHandler(ctx, issueId);
  },
});

export const incrementFailure = mutation({
  args: {
    issueId: v.id("issues"),
    maxFailures: v.number(),
    reopenToOpen: v.optional(v.boolean()),
  },
  handler: async (ctx, { issueId, maxFailures, reopenToOpen }) => {
    const issue = await getActiveIssue(ctx, issueId);

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
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(
        `Failed to read back issue ${issueId} after incrementFailure`,
      );
    return updated;
  },
});

export const incrementReviewIterations = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const issue = await getActiveIssue(ctx, issueId);

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

    // Primary: full-text search on title via search index (relevance-ranked)
    const titleMatches = await ctx.db
      .query("issues")
      .withSearchIndex("search_title", (q) =>
        q.search("title", args.query).eq("projectId", args.projectId),
      )
      .take(cap);

    // Secondary: scan non-deleted issues for description matches (case-insensitive substring)
    const queryLower = args.query.toLowerCase();
    const nonDeletedIssues = await ctx.db
      .query("issues")
      .withIndex("by_project_deletedAt_status", (q) =>
        q.eq("projectId", args.projectId).eq("deletedAt", undefined),
      )
      .collect();

    const titleMatchIds = new Set(titleMatches.map((i) => i._id));
    const descriptionMatches = nonDeletedIssues.filter(
      (i) =>
        !titleMatchIds.has(i._id) &&
        i.description?.toLowerCase().includes(queryLower),
    );

    // Title matches first (relevance-ranked), then description matches, capped
    const combined = [
      ...titleMatches.filter((i) => i.deletedAt === undefined),
      ...descriptionMatches,
    ].slice(0, cap);

    return combined;
  },
});

/** Shared handler: reset a stuck issue for a fresh attempt. */
async function retryHandler(ctx: MutationCtx, issueId: Id<"issues">) {
  const issue = await getActiveIssue(ctx, issueId);
  if (issue.status !== IssueStatus.Stuck)
    throw new Error(
      `Cannot retry issue ${issueId}: not stuck (status: ${issue.status})`,
    );

  await ctx.db.patch(issueId, {
    status: IssueStatus.Open,
    failureCount: 0,
    reviewIterations: 0,
    assignee: undefined,
    updatedAt: Date.now(),
  });
  const updated = await ctx.db.get(issueId);
  if (!updated)
    throw new Error(`Failed to read back issue ${issueId} after retry`);
  return updated;
}

export const retry = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    return await retryHandler(ctx, issueId);
  },
});
