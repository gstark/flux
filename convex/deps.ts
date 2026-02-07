import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { IssueStatus } from "./schema";

export const add = mutation({
  args: {
    blockerId: v.id("issues"),
    blockedId: v.id("issues"),
  },
  handler: async (ctx, { blockerId, blockedId }) => {
    if (blockerId === blockedId) {
      throw new Error("An issue cannot block itself.");
    }

    // Verify both issues exist
    const [blocker, blocked] = await Promise.all([
      ctx.db.get(blockerId),
      ctx.db.get(blockedId),
    ]);
    if (!blocker) throw new Error(`Blocker issue ${blockerId} not found`);
    if (!blocked) throw new Error(`Blocked issue ${blockedId} not found`);

    // Check for duplicate via compound index — single row lookup instead of collect+scan
    const existing = await ctx.db
      .query("dependencies")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", blockerId).eq("blockedId", blockedId),
      )
      .first();
    if (existing) {
      throw new Error(
        `Dependency already exists: ${blocker.shortId} blocks ${blocked.shortId}`,
      );
    }

    // Cycle detection: BFS from blockerId following blocked→blocker edges.
    // If we can reach blockedId, adding this edge would create a cycle.
    const visited = new Set<string>();
    const queue = [blockerId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // What blocks `current`? Follow the reverse direction.
      const blockers = await ctx.db
        .query("dependencies")
        .withIndex("by_blocked", (q) => q.eq("blockedId", current))
        .collect();

      for (const dep of blockers) {
        if (dep.blockerId === blockedId) {
          throw new Error(
            `Adding this dependency would create a cycle: ${blocked.shortId} already transitively blocks ${blocker.shortId}`,
          );
        }
        queue.push(dep.blockerId);
      }
    }

    return await ctx.db.insert("dependencies", { blockerId, blockedId });
  },
});

export const remove = mutation({
  args: {
    blockerId: v.id("issues"),
    blockedId: v.id("issues"),
  },
  handler: async (ctx, { blockerId, blockedId }) => {
    // Compound index: direct lookup instead of collect+find
    const dep = await ctx.db
      .query("dependencies")
      .withIndex("by_blocker_blocked", (q) =>
        q.eq("blockerId", blockerId).eq("blockedId", blockedId),
      )
      .first();
    if (!dep) {
      throw new Error("Dependency not found.");
    }

    await ctx.db.delete(dep._id);
    return { deleted: dep._id };
  },
});

export const listForIssue = query({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, { issueId }) => {
    // Issues that block this one (must complete before this one can start)
    const blockerDeps = await ctx.db
      .query("dependencies")
      .withIndex("by_blocked", (q) => q.eq("blockedId", issueId))
      .collect();

    // Issues that this one blocks (can't start until this one completes)
    const blockedDeps = await ctx.db
      .query("dependencies")
      .withIndex("by_blocker_blocked", (q) => q.eq("blockerId", issueId))
      .collect();

    // Resolve issue details for each
    const blockers = await Promise.all(
      blockerDeps.map(async (d) => {
        const issue = await ctx.db.get(d.blockerId);
        return {
          depId: d._id,
          issueId: d.blockerId,
          shortId: issue?.shortId,
          title: issue?.title,
          status: issue?.status,
        };
      }),
    );

    const blocks = await Promise.all(
      blockedDeps.map(async (d) => {
        const issue = await ctx.db.get(d.blockedId);
        return {
          depId: d._id,
          issueId: d.blockedId,
          shortId: issue?.shortId,
          title: issue?.title,
          status: issue?.status,
        };
      }),
    );

    return { blockers, blocks };
  },
});

/**
 * Returns the set of issue IDs that are blocked by at least one non-closed issue.
 * Used by issues.ready to exclude blocked issues from the work queue.
 */
export const blockedIssueIds = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // Get all dependencies — no project-scoped index, so collect all.
    // Fine at current scale; if deps table grows large, add a projectId field.
    const allDeps = await ctx.db.query("dependencies").collect();

    // For each unique blockedId, check if any blocker is not closed
    const blockedIdSet = new Set(allDeps.map((d) => d.blockedId));
    const result = new Set<string>();

    for (const blockedId of blockedIdSet) {
      const issue = await ctx.db.get(blockedId);
      // Skip deps for issues not in this project
      if (!issue || issue.projectId !== projectId) continue;

      const blockerDeps = allDeps.filter((d) => d.blockedId === blockedId);
      for (const dep of blockerDeps) {
        const blocker = await ctx.db.get(dep.blockerId);
        if (blocker && blocker.status !== IssueStatus.Closed) {
          result.add(blockedId);
          break;
        }
      }
    }

    return [...result];
  },
});
