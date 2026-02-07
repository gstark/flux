import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  dispositionValidator,
  SessionStatus,
  sessionStatusValidator,
  sessionTypeValidator,
} from "./schema";

async function querySessions(
  ctx: QueryCtx,
  args: { projectId: Id<"projects">; status?: string },
) {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
    .collect();

  const filtered = args.status
    ? sessions.filter((s) => s.status === args.status)
    : sessions;

  filtered.sort((a, b) => b.startedAt - a.startedAt);
  return filtered;
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    issueId: v.id("issues"),
    type: sessionTypeValidator,
    agent: v.string(),
    pid: v.optional(v.number()),
    agentSessionId: v.optional(v.string()),
    startHead: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);

    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error(`Issue ${args.issueId} not found`);

    const sessionId = await ctx.db.insert("sessions", {
      projectId: args.projectId,
      issueId: args.issueId,
      type: args.type,
      agent: args.agent,
      status: SessionStatus.Running,
      startedAt: Date.now(),
      pid: args.pid,
      agentSessionId: args.agentSessionId,
      startHead: args.startHead,
      model: args.model,
    });

    return await ctx.db.get(sessionId);
  },
});

export const update = mutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(sessionStatusValidator),
    endedAt: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    lastHeartbeat: v.optional(v.number()),
    disposition: v.optional(dispositionValidator),
    note: v.optional(v.string()),
    agentSessionId: v.optional(v.string()),
    startHead: v.optional(v.string()),
    endHead: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error(`Session ${args.sessionId} not found`);

    const updates: Record<string, unknown> = {};
    if (args.status !== undefined) updates.status = args.status;
    if (args.endedAt !== undefined) updates.endedAt = args.endedAt;
    if (args.exitCode !== undefined) updates.exitCode = args.exitCode;
    if (args.lastHeartbeat !== undefined)
      updates.lastHeartbeat = args.lastHeartbeat;
    if (args.disposition !== undefined) updates.disposition = args.disposition;
    if (args.note !== undefined) updates.note = args.note;
    if (args.agentSessionId !== undefined)
      updates.agentSessionId = args.agentSessionId;
    if (args.startHead !== undefined) updates.startHead = args.startHead;
    if (args.endHead !== undefined) updates.endHead = args.endHead;

    await ctx.db.patch(args.sessionId, updates);
    return await ctx.db.get(args.sessionId);
  },
});

export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(sessionStatusValidator),
  },
  handler: async (ctx, args) => {
    return await querySessions(ctx, args);
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const listWithIssues = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(sessionStatusValidator),
  },
  handler: async (ctx, args) => {
    const sessions = await querySessions(ctx, args);

    const enriched = await Promise.all(
      sessions.map(async (session) => {
        const issue = await ctx.db.get(session.issueId);
        return {
          ...session,
          issueShortId: issue?.shortId ?? null,
        };
      }),
    );

    return enriched;
  },
});
