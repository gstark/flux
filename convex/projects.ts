import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import { IssueStatus, SessionStatus } from "./schema";

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    path: v.optional(v.string()),
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
      enabled: true,
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
        const openIssues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("deletedAt", undefined)
              .eq("status", IssueStatus.Open),
          )
          .collect();

        const inProgressIssues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("deletedAt", undefined)
              .eq("status", IssueStatus.InProgress),
          )
          .collect();

        const runningSessions = await ctx.db
          .query("sessions")
          .withIndex("by_project_status_startedAt", (q) =>
            q.eq("projectId", project._id).eq("status", SessionStatus.Running),
          )
          .collect();

        return {
          ...project,
          openIssueCount: openIssues.length + inProgressIssues.length,
          activeSessionCount: runningSessions.length,
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
// labels, epics, and configs can exceed this in a single transaction.
//
// Strategy: an internalAction loops through cleanup steps, calling an
// internalMutation per batch. Each batch stays well under the limit.

/**
 * Maximum documents to delete per batch mutation.
 * Each doc requires a read + delete = 2 operations. 500 deletes ≈ 1000 ops,
 * well under the ~8192 limit even accounting for index queries.
 */
const CASCADE_BATCH_SIZE = 500;

/**
 * Cascade cleanup steps, processed in order. Leaf data (comments, deps,
 * sessionEvents) is deleted before their parents (issues, sessions) so
 * indexes remain consistent within each batch mutation.
 */
const CascadeSteps = {
  Comments: "comments",
  DependenciesBlocker: "dependencies_blocker",
  DependenciesBlocked: "dependencies_blocked",
  SessionEvents: "sessionEvents",
  Issues: "issues",
  Sessions: "sessions",
  Labels: "labels",
  Epics: "epics",
  OrchestratorConfig: "orchestratorConfig",
} as const;

type CascadeStep = (typeof CascadeSteps)[keyof typeof CascadeSteps];

const cascadeStepValidator = v.union(
  v.literal(CascadeSteps.Comments),
  v.literal(CascadeSteps.DependenciesBlocker),
  v.literal(CascadeSteps.DependenciesBlocked),
  v.literal(CascadeSteps.SessionEvents),
  v.literal(CascadeSteps.Issues),
  v.literal(CascadeSteps.Sessions),
  v.literal(CascadeSteps.Labels),
  v.literal(CascadeSteps.Epics),
  v.literal(CascadeSteps.OrchestratorConfig),
);

const CASCADE_STEPS: CascadeStep[] = [
  CascadeSteps.Comments,
  CascadeSteps.DependenciesBlocker,
  CascadeSteps.DependenciesBlocked,
  CascadeSteps.SessionEvents,
  CascadeSteps.Issues,
  CascadeSteps.Sessions,
  CascadeSteps.Labels,
  CascadeSteps.Epics,
  CascadeSteps.OrchestratorConfig,
];

/**
 * Background action that orchestrates chunked cascade deletion.
 * Loops through each table, deleting in batches until all child data is gone.
 */
export const cascadeDeleteProject = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    for (const step of CASCADE_STEPS) {
      let hasMore = true;
      while (hasMore) {
        const result = await ctx.runMutation(
          internal.projects.cascadeDeleteBatch,
          { projectId, step, batchSize: CASCADE_BATCH_SIZE },
        );
        hasMore = result.deleted >= CASCADE_BATCH_SIZE;
      }
    }
  },
});

/**
 * Delete up to `batchSize` orphaned documents for one cascade step.
 * Returns the count of documents deleted so the action knows whether to loop.
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
      case CascadeSteps.Comments: {
        // Comments reference issues which reference the project.
        // We must find the project's issues first, then their comments.
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", projectId),
          )
          .collect();
        for (const issue of issues) {
          if (deleted >= batchSize) break;
          const comments = await ctx.db
            .query("comments")
            .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
            .take(batchSize - deleted);
          for (const comment of comments) {
            await ctx.db.delete(comment._id);
            deleted++;
          }
        }
        break;
      }

      case CascadeSteps.DependenciesBlocker: {
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", projectId),
          )
          .collect();
        for (const issue of issues) {
          if (deleted >= batchSize) break;
          const deps = await ctx.db
            .query("dependencies")
            .withIndex("by_blocker_blocked", (q) =>
              q.eq("blockerId", issue._id),
            )
            .take(batchSize - deleted);
          for (const dep of deps) {
            await ctx.db.delete(dep._id);
            deleted++;
          }
        }
        break;
      }

      case CascadeSteps.DependenciesBlocked: {
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", projectId),
          )
          .collect();
        for (const issue of issues) {
          if (deleted >= batchSize) break;
          const deps = await ctx.db
            .query("dependencies")
            .withIndex("by_blocked", (q) => q.eq("blockedId", issue._id))
            .take(batchSize - deleted);
          for (const dep of deps) {
            await ctx.db.delete(dep._id);
            deleted++;
          }
        }
        break;
      }

      case CascadeSteps.SessionEvents: {
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_project_startedAt", (q) =>
            q.eq("projectId", projectId),
          )
          .collect();
        for (const session of sessions) {
          if (deleted >= batchSize) break;
          const events = await ctx.db
            .query("sessionEvents")
            .withIndex("by_session_sequence", (q) =>
              q.eq("sessionId", session._id),
            )
            .take(batchSize - deleted);
          for (const event of events) {
            await ctx.db.delete(event._id);
            deleted++;
          }
        }
        break;
      }

      case CascadeSteps.Issues: {
        const issues = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q.eq("projectId", projectId),
          )
          .take(batchSize);
        for (const issue of issues) {
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
          .take(batchSize);
        for (const session of sessions) {
          await ctx.db.delete(session._id);
          deleted++;
        }
        break;
      }

      case CascadeSteps.Labels: {
        const labels = await ctx.db
          .query("labels")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .take(batchSize);
        for (const label of labels) {
          await ctx.db.delete(label._id);
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

      default: {
        const _exhaustive: never = step;
        throw new Error(`Unknown cascade step: ${_exhaustive}`);
      }
    }

    return { deleted };
  },
});
