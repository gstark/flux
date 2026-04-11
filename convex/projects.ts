import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { countIssuesByStatus } from "./issues";
import { IssueStatus, SessionStatus } from "./schema";
import { countSessionsByStatus } from "./sessions";

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    path: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (existing) {
      throw new Error(`Project "${args.slug}" already exists`);
    }

    const projectId = await ctx.db.insert("projects", {
      slug: args.slug,
      name: args.name,
      issueCounter: 0,
      path: args.path ?? "",
      enabled: args.enabled ?? true,
    });

    await ctx.scheduler.runAfter(0, internal.seeds.runAll, { projectId });

    return projectId;
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    path: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    workPrompt: v.optional(v.string()),
    retroPrompt: v.optional(v.string()),
    reviewPrompt: v.optional(v.string()),
    plannerPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    const updates: Partial<Doc<"projects">> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.path !== undefined) updates.path = args.path;
    if (args.enabled !== undefined) updates.enabled = args.enabled;
    if (args.workPrompt !== undefined) updates.workPrompt = args.workPrompt;
    if (args.retroPrompt !== undefined) updates.retroPrompt = args.retroPrompt;
    if (args.reviewPrompt !== undefined)
      updates.reviewPrompt = args.reviewPrompt;
    if (args.plannerPrompt !== undefined)
      updates.plannerPrompt = args.plannerPrompt;

    if (args.slug !== undefined) {
      const newSlug = args.slug;
      if (newSlug !== project.slug) {
        const existing = await ctx.db
          .query("projects")
          .withIndex("by_slug", (q) => q.eq("slug", newSlug))
          .unique();
        if (existing) {
          throw new Error(`Project slug "${newSlug}" already taken`);
        }
      }
      updates.slug = newSlug;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("No fields to update");
    }

    await ctx.db.patch(args.projectId, updates);
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const getById = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db.get(projectId);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

/** Returns all projects enriched with open issue count and active session flag. */
export const listWithStats = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();

    return await Promise.all(
      projects.map(async (project) => {
        const [issueCounts, sessionCounts] = await Promise.all([
          countIssuesByStatus(ctx.db, project._id, [
            IssueStatus.Open,
            IssueStatus.InProgress,
          ]),
          countSessionsByStatus(ctx.db, project._id, [SessionStatus.Running]),
        ]);

        return {
          ...project,
          openIssueCount:
            (issueCounts[IssueStatus.Open] ?? 0) +
            (issueCounts[IssueStatus.InProgress] ?? 0),
          activeSessionCount: sessionCounts[SessionStatus.Running] ?? 0,
        };
      }),
    );
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Delete the project row immediately — prevents new data from referencing it.
    // Child data becomes orphaned and is cleaned up by the scheduled cascade.
    await ctx.db.delete(projectId);

    // Schedule background cascade cleanup for all child data.
    await ctx.scheduler.runAfter(0, internal.projects.cascadeDeleteProject, {
      projectId,
    });
  },
});

// ── Chunked cascade deletion ─────────────────────────────────────────
//
// Convex limits ~8192 document operations per mutation. A project with many
// issues (each with comments, dependencies), sessions (each with events),
// epics, and configs can exceed this in a single transaction.
//
// Strategy: an internalAction loops through cleanup steps, calling an
// internalMutation per batch. Each batch stays well under the limit.
//
// FLUX-348: Leaf data (comments, deps, sessionEvents) is deleted inline
// with its parent. Each issue/session batch reads a bounded page of parents,
// deletes all their children, then deletes the parents themselves. This
// avoids the unbounded .collect() that previously read ALL parents on
// every batch call.

/**
 * Soft cap on deletes per batch mutation. Gates entry to new parents — once
 * `deleted >= CASCADE_BATCH_SIZE`, no new parent is started. A single parent
 * may overshoot by up to 3×CHILDREN_PER_PARENT_LIMIT (one per child type),
 * but total ops stay well under the ~8192 Convex mutation limit.
 */
const CASCADE_BATCH_SIZE = 500;

/**
 * Maximum parent documents (issues/sessions) to process per batch.
 * For each parent we read + delete its children, then delete the parent.
 * A smaller page keeps total operations bounded even when parents have
 * many children. The action loop calls repeatedly until parents are
 * exhausted.
 */
const PARENT_PAGE_SIZE = 50;

/**
 * Maximum children to delete per parent per batch. Prevents a single
 * parent with thousands of children from blowing the operation limit.
 * When a parent has more children than this, the batch returns early
 * and the action loop processes the same parent again on the next call.
 */
const CHILDREN_PER_PARENT_LIMIT = 200;

/**
 * Cascade cleanup steps, processed in order.
 * Issues and Sessions delete their children inline (FLUX-348).
 */
const CascadeSteps = {
  Issues: "issues",
  Sessions: "sessions",
  Epics: "epics",
  OrchestratorConfig: "orchestratorConfig",
  StatusCounts: "statusCounts",
} as const;

type CascadeStep = (typeof CascadeSteps)[keyof typeof CascadeSteps];

const cascadeStepValidator = v.union(
  v.literal(CascadeSteps.Issues),
  v.literal(CascadeSteps.Sessions),
  v.literal(CascadeSteps.Epics),
  v.literal(CascadeSteps.OrchestratorConfig),
  v.literal(CascadeSteps.StatusCounts),
);

const CASCADE_STEPS: CascadeStep[] = [
  CascadeSteps.Issues,
  CascadeSteps.Sessions,
  CascadeSteps.Epics,
  CascadeSteps.OrchestratorConfig,
  CascadeSteps.StatusCounts,
];

/** Maximum retry attempts for each batch mutation in the cascade. */
const CASCADE_MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff between retries. */
const CASCADE_RETRY_BASE_DELAY_MS = 250;

/**
 * Retry a mutation with exponential backoff.
 * cascadeDeleteBatch is idempotent, so retries are safe.
 */
async function retryMutation<T>(
  fn: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = CASCADE_RETRY_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Background action that orchestrates chunked cascade deletion.
 * Loops through each table, deleting in batches until all child data is gone.
 * Each batch mutation is retried with exponential backoff on transient failures.
 */
export const cascadeDeleteProject = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    for (const step of CASCADE_STEPS) {
      let hasMore = true;
      while (hasMore) {
        const result = await retryMutation(
          () =>
            ctx.runMutation(internal.projects.cascadeDeleteBatch, {
              projectId,
              step,
              batchSize: CASCADE_BATCH_SIZE,
            }),
          CASCADE_MAX_RETRIES,
        );
        hasMore = result.deleted >= 1;
      }
    }
  },
});

/**
 * Delete up to `batchSize` orphaned documents for one cascade step.
 *
 * For Issues: reads a bounded page of issues, deletes each issue's comments
 * and dependencies first, then deletes the issue. If any issue still has
 * remaining children (hit CHILDREN_PER_PARENT_LIMIT), returns early so the
 * action loop re-processes it.
 *
 * For Sessions: reads a bounded page of sessions, deletes each session's
 * events first, then deletes the session.
 *
 * For Labels/Epics/OrchestratorConfig: directly queryable by projectId,
 * deleted in simple batches.
 */
export const cascadeDeleteBatch = internalMutation({
  args: {
    projectId: v.id("projects"),
    step: cascadeStepValidator,
    batchSize: v.number(),
  },
  handler: async (ctx, { projectId, step, batchSize }) => {
    let deleted = 0;

    switch (step) {
      case CascadeSteps.Issues: {
        // Read a bounded page of issues and delete each with its children.
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", projectId),
          )
          .take(PARENT_PAGE_SIZE);

        for (const issue of issues) {
          if (deleted >= batchSize) break;

          // Delete comments for this issue
          const comments = await ctx.db
            .query("comments")
            .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
            .take(CHILDREN_PER_PARENT_LIMIT);
          for (const comment of comments) {
            await ctx.db.delete(comment._id);
            deleted++;
          }
          // If we hit the child limit, this issue has more children.
          // Return early so the action loop re-processes it.
          if (comments.length >= CHILDREN_PER_PARENT_LIMIT) break;

          // Delete dependencies where this issue is the blocker
          const depsBlocker = await ctx.db
            .query("dependencies")
            .withIndex("by_blocker_blocked", (q) =>
              q.eq("blockerId", issue._id),
            )
            .take(CHILDREN_PER_PARENT_LIMIT);
          for (const dep of depsBlocker) {
            await ctx.db.delete(dep._id);
            deleted++;
          }
          if (depsBlocker.length >= CHILDREN_PER_PARENT_LIMIT) break;

          // Delete dependencies where this issue is blocked
          const depsBlocked = await ctx.db
            .query("dependencies")
            .withIndex("by_blocked", (q) => q.eq("blockedId", issue._id))
            .take(CHILDREN_PER_PARENT_LIMIT);
          for (const dep of depsBlocked) {
            await ctx.db.delete(dep._id);
            deleted++;
          }
          if (depsBlocked.length >= CHILDREN_PER_PARENT_LIMIT) break;

          // All children deleted — safe to delete the issue itself.
          await ctx.db.delete(issue._id);
          deleted++;
        }
        break;
      }

      case CascadeSteps.Sessions: {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_project_startedAt", (q) =>
            q.eq("projectId", projectId),
          )
          .take(PARENT_PAGE_SIZE);

        for (const session of sessions) {
          if (deleted >= batchSize) break;

          // Delete session events
          const events = await ctx.db
            .query("sessionEvents")
            .withIndex("by_session_sequence", (q) =>
              q.eq("sessionId", session._id),
            )
            .take(CHILDREN_PER_PARENT_LIMIT);
          for (const event of events) {
            await ctx.db.delete(event._id);
            deleted++;
          }
          if (events.length >= CHILDREN_PER_PARENT_LIMIT) break;

          // All events deleted — safe to delete the session itself.
          await ctx.db.delete(session._id);
          deleted++;
        }
        break;
      }

      case CascadeSteps.Epics: {
        const epics = await ctx.db
          .query("epics")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .take(batchSize);
        for (const epic of epics) {
          await ctx.db.delete(epic._id);
          deleted++;
        }
        break;
      }

      case CascadeSteps.OrchestratorConfig: {
        const configs = await ctx.db
          .query("orchestratorConfig")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .take(batchSize);
        for (const config of configs) {
          await ctx.db.delete(config._id);
          deleted++;
        }
        break;
      }

      case CascadeSteps.StatusCounts: {
        const counters = await ctx.db
          .query("statusCounts")
          .withIndex("by_project_entity_status", (q) =>
            q.eq("projectId", projectId),
          )
          .take(batchSize);
        for (const counter of counters) {
          await ctx.db.delete(counter._id);
          deleted++;
        }
        break;
      }

      default: {
        const _exhaustive: never = step;
        throw new Error(`Unknown cascade step: ${_exhaustive}`);
      }
    }

    return { deleted };
  },
});
