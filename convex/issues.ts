import { paginationOptsValidator } from "convex/server";
import { type Validator, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  closeTypeValidator,
  IssuePriority,
  type IssuePriorityValue,
  IssueStatus,
  issuePriorityValidator,
  issueStatusValidator,
} from "./schema";

const PRIORITY_ORDER: Record<IssuePriorityValue, number> = {
  [IssuePriority.Critical]: 0,
  [IssuePriority.High]: 1,
  [IssuePriority.Medium]: 2,
  [IssuePriority.Low]: 3,
};

/** Convert a priority string to its numeric sort order. */
function toPriorityOrder(priority: IssuePriorityValue): number {
  const order = PRIORITY_ORDER[priority];
  if (order === undefined)
    throw new Error(`Unknown priority: ${String(priority)}`);
  return order;
}

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

    const priority = args.priority ?? IssuePriority.Medium;
    const issueId = await ctx.db.insert("issues", {
      projectId: args.projectId,
      shortId: generateShortId(project.slug, counter),
      title: args.title,
      description: args.description,
      status: IssueStatus.Open,
      priority,
      priorityOrder: toPriorityOrder(priority),
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
      const priority = issue.priority ?? IssuePriority.Medium;
      const issueId = await ctx.db.insert("issues", {
        projectId: args.projectId,
        shortId: generateShortId(project.slug, counter),
        title: issue.title,
        description: issue.description,
        status: IssueStatus.Open,
        priority,
        priorityOrder: toPriorityOrder(priority),
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

    // Index-sorted by priorityOrder — no in-memory sort needed
    const { status } = args;
    const issues = status
      ? await ctx.db
          .query("issues")
          .withIndex("by_project_status_priority", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("deletedAt", undefined)
              .eq("status", status),
          )
          .take(cap)
      : await ctx.db
          .query("issues")
          .withIndex("by_project_priority", (q) =>
            q.eq("projectId", args.projectId).eq("deletedAt", undefined),
          )
          .take(cap);

    return issues;
  },
});

export const listPaginated = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(issueStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { status } = args;
    return status
      ? await ctx.db
          .query("issues")
          .withIndex("by_project_status_priority", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("deletedAt", undefined)
              .eq("status", status),
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("issues")
          .withIndex("by_project_priority", (q) =>
            q.eq("projectId", args.projectId).eq("deletedAt", undefined),
          )
          .paginate(args.paginationOpts);
  },
});

export const ready = query({
  args: {
    projectId: v.id("projects"),
    maxFailures: v.number(),
  },
  handler: async (ctx, { projectId, maxFailures }) => {
    // Index returns open issues sorted by priorityOrder; filter failureCount in-memory
    const openIssues = await ctx.db
      .query("issues")
      .withIndex("by_project_status_priority", (q) =>
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

    // Already sorted by priorityOrder via the index — no in-memory sort needed
    return ready;
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

export const bulkUpdate = mutation({
  args: {
    updates: v.array(
      v.object({
        issueId: v.id("issues"),
        status: v.optional(issueStatusValidator),
        priority: v.optional(issuePriorityValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updated = [];

    for (const { issueId, priority, ...rest } of args.updates) {
      await getActiveIssue(ctx, issueId);

      const patch: Partial<Doc<"issues">> = {
        updatedAt: now,
        ...buildPatch(rest),
        ...(priority !== undefined && {
          priority,
          priorityOrder: toPriorityOrder(priority),
        }),
      };

      await ctx.db.patch(issueId, patch);
      const doc = await ctx.db.get(issueId);
      if (!doc)
        throw new Error(`Failed to read back issue ${issueId} after update`);
      updated.push(doc);
    }

    return updated;
  },
});

/** Wrap a validator with v.null() so callers can pass null to clear the field. */
// biome-ignore lint/suspicious/noExplicitAny: Convex's Validator type requires `any` in generic params
function nullable(validator: Validator<any, "required", any>) {
  return v.optional(v.union(validator, v.null()));
}

/**
 * Build a patch object from args, handling the null-clearing convention:
 * - undefined → field not provided → omit from patch (don't touch it)
 * - null      → caller wants to clear the field → include as undefined
 * - any value → caller wants to set the field → include as-is
 */
function buildPatch(args: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(args)) {
    if (val === undefined) continue; // not provided — skip
    patch[key] = val === null ? undefined : val; // null → clear, else set
  }
  return patch;
}

export const update = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: nullable(v.string()),
    status: v.optional(issueStatusValidator),
    priority: v.optional(issuePriorityValidator),
    assignee: nullable(v.string()),
    sourceIssueId: nullable(v.id("issues")),
    closeType: nullable(closeTypeValidator),
    closeReason: nullable(v.string()),
    deferNote: nullable(v.string()),
    epicId: nullable(v.id("epics")),
    labelIds: nullable(v.array(v.id("labels"))),
  },
  handler: async (ctx, args) => {
    await getActiveIssue(ctx, args.issueId);

    const { issueId, priority, ...rest } = args;
    const patch: Partial<Doc<"issues">> = {
      updatedAt: Date.now(),
      ...buildPatch(rest),
      ...(priority !== undefined && {
        priority,
        priorityOrder: toPriorityOrder(priority),
      }),
    };

    await ctx.db.patch(issueId, patch);
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${issueId} after update`);
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

export const defer = mutation({
  args: {
    issueId: v.id("issues"),
    note: v.string(),
  },
  handler: async (ctx, { issueId, note }) => {
    const issue = await getActiveIssue(ctx, issueId);
    if (issue.status === IssueStatus.Deferred) return issue;
    if (issue.status === IssueStatus.Closed) {
      throw new Error(`Cannot defer issue ${issueId}: already closed`);
    }

    await ctx.db.patch(issueId, {
      status: IssueStatus.Deferred,
      deferNote: note,
      assignee: undefined,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${issueId} after defer`);
    return updated;
  },
});

export const undefer = mutation({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, { issueId }) => {
    const issue = await getActiveIssue(ctx, issueId);
    if (issue.status === IssueStatus.Open) return issue;
    if (issue.status !== IssueStatus.Deferred) {
      throw new Error(
        `Cannot undefer issue ${issueId}: not deferred (status: ${issue.status})`,
      );
    }

    await ctx.db.patch(issueId, {
      status: IssueStatus.Open,
      deferNote: undefined,
      assignee: undefined,
      updatedAt: Date.now(),
    });
    const updated = await ctx.db.get(issueId);
    if (!updated)
      throw new Error(`Failed to read back issue ${issueId} after undefer`);
    return updated;
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
    const exceeded = newCount >= maxFailures;
    const reopen = !exceeded && reopenToOpen !== false;

    const patch: Partial<Doc<"issues">> = {
      failureCount: newCount,
      updatedAt: Date.now(),
      ...(exceeded && { status: IssueStatus.Stuck, assignee: undefined }),
      ...(reopen && { status: IssueStatus.Open, assignee: undefined }),
    };

    await ctx.db.patch(issueId, patch);
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

    // If the query looks like a shortId (e.g. "FLUX-42"), do a direct index lookup first
    const shortIdMatch = /^[A-Za-z]+-\d+$/.test(args.query.trim())
      ? await ctx.db
          .query("issues")
          .withIndex("by_project_shortId", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("shortId", args.query.trim().toUpperCase()),
          )
          .first()
      : null;

    // Full-text search on title via search index (relevance-ranked)
    const textResults = await ctx.db
      .query("issues")
      .withSearchIndex("search_title", (q) =>
        q.search("title", args.query).eq("projectId", args.projectId),
      )
      .take(cap);

    // Merge: shortId hit first, then full-text results (deduped), exclude deleted
    const seen = new Set<string>();
    const merged: Doc<"issues">[] = [];
    for (const issue of [
      ...(shortIdMatch ? [shortIdMatch] : []),
      ...textResults,
    ]) {
      if (issue.deletedAt !== undefined) continue;
      if (seen.has(issue._id)) continue;
      seen.add(issue._id);
      merged.push(issue);
    }
    return merged.slice(0, cap);
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

export const counts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const statuses = Object.values(IssueStatus);
    const buckets = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q
              .eq("projectId", args.projectId)
              .eq("deletedAt", undefined)
              .eq("status", status),
          )
          .collect(),
      ),
    );
    const counts: Record<string, number> = Object.fromEntries(
      statuses.map((status, i) => [status, buckets[i]?.length ?? 0]),
    );
    return counts;
  },
});
