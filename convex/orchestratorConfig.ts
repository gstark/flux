import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { AgentKind, agentKindValidator } from "./schema";

export const exists = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const config = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    return config !== null;
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
  },
});

/** Ensure an orchestratorConfig row exists for a project (upsert). */
export const ensureExists = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const config = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (config) return config._id;

    return await ctx.db.insert("orchestratorConfig", {
      projectId,
      agent: AgentKind.Claude,
      sessionTimeoutMs: 30 * 60 * 1000,
      maxFailures: 3,
      maxReviewIterations: 10,
    });
  },
});

export const update = mutation({
  args: {
    projectId: v.id("projects"),
    agent: v.optional(agentKindValidator),
    maxReviewIterations: v.optional(v.number()),
    maxFailures: v.optional(v.number()),
    sessionTimeoutMs: v.optional(v.number()),
    focusEpicId: v.optional(v.union(v.id("epics"), v.null())),
  },
  handler: async (ctx, { projectId, focusEpicId, ...patch }) => {
    const config = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!config) {
      throw new Error(`No orchestrator config found for project ${projectId}`);
    }
    const numericFields = [
      "maxReviewIterations",
      "maxFailures",
      "sessionTimeoutMs",
    ] as const;
    for (const key of numericFields) {
      const val = patch[key];
      if (val !== undefined && (!Number.isInteger(val) || val < 1)) {
        throw new Error(`${key} must be a positive integer, got ${val}`);
      }
    }
    // Strip undefined values from numeric fields, then handle focusEpicId
    const updates: Partial<Doc<"orchestratorConfig">> = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    // Handle focusEpicId: null clears it, undefined means no change
    if (focusEpicId !== undefined) {
      updates.focusEpicId = focusEpicId === null ? undefined : focusEpicId;
    }
    await ctx.db.patch(config._id, updates);
    return { success: true };
  },
});
