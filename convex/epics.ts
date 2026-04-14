import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { EpicStatus, epicStatusValidator } from "./schema";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    useWorktree: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);

    if (args.useWorktree && !project.worktreeBase) {
      throw new Error(
        "Cannot enable worktree on epic: project has no worktreeBase configured. " +
          "Set worktreeBase on the project first.",
      );
    }

    const worktreeSlug = args.useWorktree ? slugify(args.title) : undefined;
    if (args.useWorktree && !worktreeSlug) {
      throw new Error(
        `Epic title "${args.title}" produces an empty slug — cannot use as worktree name.`,
      );
    }

    return await ctx.db.insert("epics", {
      projectId: args.projectId,
      title: args.title,
      description: args.description,
      status: EpicStatus.Open,
      useWorktree: args.useWorktree,
      worktreeSlug,
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

    // Compound index narrows by status when provided, avoiding in-memory filter
    const { status } = args;
    const epics: Doc<"epics">[] = status
      ? await ctx.db
          .query("epics")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", args.projectId).eq("status", status),
          )
          .take(cap)
      : await ctx.db
          .query("epics")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .take(cap);

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

    const epicIssues = await ctx.db
      .query("issues")
      .withIndex("by_epic", (q) => q.eq("epicId", args.epicId))
      .collect();

    // Strip descriptions for token efficiency, exclude soft-deleted
    const issues = epicIssues
      .filter((i) => i.deletedAt === undefined)
      .map(({ description: _description, ...rest }) => rest);

    return { ...epic, issues };
  },
});

export const update = mutation({
  args: {
    epicId: v.id("epics"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    useWorktree: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { epicId, ...rest } = args;
    const epic = await ctx.db.get(epicId);
    if (!epic) throw new Error(`Epic ${epicId} not found`);

    if (rest.useWorktree) {
      const project = await ctx.db.get(epic.projectId);
      if (!project?.worktreeBase) {
        throw new Error(
          "Cannot enable worktree on epic: project has no worktreeBase configured. " +
            "Set worktreeBase on the project first.",
        );
      }
    }

    const patch: Partial<Doc<"epics">> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );

    if (rest.useWorktree && !epic.worktreeSlug) {
      const title = rest.title ?? epic.title;
      const slug = slugify(title);
      if (!slug) {
        throw new Error(
          `Epic title "${title}" produces an empty slug — cannot use as worktree name.`,
        );
      }
      patch.worktreeSlug = slug;
    }

    if (Object.keys(patch).length === 0) return epic;

    await ctx.db.patch(epicId, patch);
    return await ctx.db.get(epicId);
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
