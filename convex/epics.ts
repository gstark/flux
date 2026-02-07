import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { EpicStatus, epicStatusValidator } from "./schema";

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);

    return await ctx.db.insert("epics", {
      projectId: args.projectId,
      title: args.title,
      description: args.description,
      status: EpicStatus.Open,
    });
  },
});

export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(epicStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cap = Math.min(args.limit ?? 50, 200);

    let epics = await ctx.db
      .query("epics")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(cap);

    if (args.status) {
      epics = epics.filter((e) => e.status === args.status);
    }

    // Most recent first
    epics.sort((a, b) => b._creationTime - a._creationTime);

    return epics;
  },
});

export const get = query({
  args: { epicId: v.id("epics") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.epicId);
  },
});

export const show = query({
  args: { epicId: v.id("epics") },
  handler: async (ctx, args) => {
    const epic = await ctx.db.get(args.epicId);
    if (!epic) return null;

    const allIssues = await ctx.db
      .query("issues")
      .withIndex("by_project", (q) => q.eq("projectId", epic.projectId))
      .collect();

    // Filter to this epic's issues and strip descriptions for token efficiency
    const issues = allIssues
      .filter((i) => i.epicId === args.epicId && i.deletedAt === undefined)
      .map(({ description: _description, ...rest }) => rest);

    return { ...epic, issues };
  },
});

export const update = mutation({
  args: {
    epicId: v.id("epics"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const epic = await ctx.db.get(args.epicId);
    if (!epic) throw new Error(`Epic ${args.epicId} not found`);

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;

    await ctx.db.patch(args.epicId, updates);
    return await ctx.db.get(args.epicId);
  },
});

export const close = mutation({
  args: {
    epicId: v.id("epics"),
    closeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const epic = await ctx.db.get(args.epicId);
    if (!epic) throw new Error(`Epic ${args.epicId} not found`);
    if (epic.status === EpicStatus.Closed) {
      throw new Error(`Epic ${args.epicId} already closed`);
    }

    await ctx.db.patch(args.epicId, {
      status: EpicStatus.Closed,
      closedAt: Date.now(),
      closeReason: args.closeReason,
    });
    return await ctx.db.get(args.epicId);
  },
});
