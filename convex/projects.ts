import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ProjectState, projectStateValidator } from "./schema";

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
      state: ProjectState.Stopped,
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
    state: v.optional(projectStateValidator),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    const updates: Partial<Doc<"projects">> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.path !== undefined) updates.path = args.path;
    if (args.state !== undefined) updates.state = args.state;

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
