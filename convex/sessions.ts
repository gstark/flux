import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  dispositionValidator,
  SessionStatus,
  sessionPhaseValidator,
  sessionStatusValidator,
  sessionTypeValidator,
} from "./schema";

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
    const { sessionId, ...rest } = args;
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const patch: Partial<Doc<"sessions">> = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );

    await ctx.db.patch(sessionId, patch);
    return await ctx.db.get(sessionId);
  },
});

export const list = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(sessionStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { status, limit } = args;
    const baseQuery = status
      ? ctx.db
          .query("sessions")
          .withIndex("by_project_status_startedAt", (q) =>
            q.eq("projectId", args.projectId).eq("status", status),
          )
          .order("desc")
      : ctx.db
          .query("sessions")
          .withIndex("by_project_startedAt", (q) =>
            q.eq("projectId", args.projectId),
          )
          .order("desc");
    return limit ? await baseQuery.take(limit) : await baseQuery.collect();
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

export const listPaginatedWithIssues = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(sessionStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { status } = args;
    const page = status
      ? await ctx.db
          .query("sessions")
          .withIndex("by_project_status_startedAt", (q) =>
            q.eq("projectId", args.projectId).eq("status", status),
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("sessions")
          .withIndex("by_project_startedAt", (q) =>
            q.eq("projectId", args.projectId),
          )
          .order("desc")
          .paginate(args.paginationOpts);

    // Enrich each session with issue shortId
    const enrichedPage = await Promise.all(
      page.page.map(async (session) => {
        const issue = await ctx.db.get(session.issueId);
        return {
          ...session,
          issueShortId: issue?.shortId ?? null,
        };
      }),
    );

    return {
      ...page,
      page: enrichedPage,
    };
  },
});

// Scaling note: .collect() fetches all documents per status to count them.
// Convex has no native indexed count, so alternatives are:
//   1. Counter table — increment/decrement on session create/status change
//   2. This approach — acceptable while session volume is low (hundreds)
// If session counts reach thousands per project, migrate to a counter table.

/**
 * Count sessions for a project, grouped by status.
 * Exported for reuse by other queries (e.g. projects.listWithStats).
 */
export async function countSessionsByStatus(
  db: DatabaseReader,
  projectId: Id<"projects">,
): Promise<Record<string, number>> {
  const statuses = Object.values(SessionStatus);
  const buckets = await Promise.all(
    statuses.map((status) =>
      db
        .query("sessions")
        .withIndex("by_project_status_startedAt", (q) =>
          q.eq("projectId", projectId).eq("status", status),
        )
        .collect(),
    ),
  );
  return Object.fromEntries(
    statuses.map((status, i) => [status, buckets[i]?.length ?? 0]),
  );
}

export const counts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return countSessionsByStatus(ctx.db, args.projectId);
  },
});
