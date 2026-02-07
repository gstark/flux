import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  dispositionValidator,
  SessionStatus,
  sessionPhaseValidator,
  sessionStatusValidator,
  sessionTypeValidator,
} from "./schema";

type SessionStatusValue = (typeof SessionStatus)[keyof typeof SessionStatus];

async function querySessions(
  ctx: QueryCtx,
  args: { projectId: Id<"projects">; status?: SessionStatusValue },
) {
  // Compound index narrows by status when provided, avoiding in-memory filter
  const { status } = args;
  const sessions = status
    ? await ctx.db
        .query("sessions")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", status),
        )
        .collect()
    : await ctx.db
        .query("sessions")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions;
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
    phase: v.optional(sessionPhaseValidator),
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
      phase: args.phase,
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
    phase: v.optional(sessionPhaseValidator),
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
    if (args.phase !== undefined) updates.phase = args.phase;

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

export const getWithIssue = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const issue = await ctx.db.get(session.issueId);
    return {
      ...session,
      issueShortId: issue?.shortId ?? null,
      issueTitle: issue?.title ?? null,
    };
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
