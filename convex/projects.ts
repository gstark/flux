import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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

    // ── Cascade through issues: comments + dependencies ──────────
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_project_deletedAt_status", (q) =>
        q.eq("projectId", projectId),
      )
      .collect();

    for (const issue of issues) {
      const comments = await ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect();
      for (const comment of comments) {
        await ctx.db.delete(comment._id);
      }

      // Dependencies where this issue is the blocker
      const blockerDeps = await ctx.db
        .query("dependencies")
        .withIndex("by_blocker_blocked", (q) => q.eq("blockerId", issue._id))
        .collect();
      for (const dep of blockerDeps) {
        await ctx.db.delete(dep._id);
      }

      // Dependencies where this issue is blocked (blocker in another project).
      // Intra-project deps are already deleted from the blocker side above —
      // Convex reads within a mutation see prior writes, so they won't appear here.
      const blockedDeps = await ctx.db
        .query("dependencies")
        .withIndex("by_blocked", (q) => q.eq("blockedId", issue._id))
        .collect();
      for (const dep of blockedDeps) {
        await ctx.db.delete(dep._id);
      }

      await ctx.db.delete(issue._id);
    }

    // ── Cascade through sessions: sessionEvents ──────────────────
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_project_startedAt", (q) => q.eq("projectId", projectId))
      .collect();

    for (const session of sessions) {
      const events = await ctx.db
        .query("sessionEvents")
        .withIndex("by_session_sequence", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const event of events) {
        await ctx.db.delete(event._id);
      }
      await ctx.db.delete(session._id);
    }

    // ── Direct children ──────────────────────────────────────────
    const labels = await ctx.db
      .query("labels")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const label of labels) {
      await ctx.db.delete(label._id);
    }

    const epics = await ctx.db
      .query("epics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const epic of epics) {
      await ctx.db.delete(epic._id);
    }

    const configs = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const config of configs) {
      await ctx.db.delete(config._id);
    }

    // ── Finally, delete the project itself ────────────────────────
    await ctx.db.delete(projectId);
  },
});
