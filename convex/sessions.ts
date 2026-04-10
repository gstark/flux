import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  CounterEntity,
  dispositionValidator,
  SessionStatus,
  type SessionStatusValue,
  sessionPhaseValidator,
  sessionStatusValidator,
  sessionTypeValidator,
} from "./schema";
import {
  adjustStatusCount,
  readStatusCounts,
  transitionStatusCount,
} from "./statusCounts";

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    issueId: v.optional(v.id("issues")),
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

    if (args.issueId) {
      const issue = await ctx.db.get(args.issueId);
      if (!issue) throw new Error(`Issue ${args.issueId} not found`);
    }

    const sessionId = await ctx.db.insert("sessions", {
      projectId: args.projectId,
      ...(args.issueId && { issueId: args.issueId }),
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

    await adjustStatusCount(
      ctx,
      args.projectId,
      CounterEntity.Sessions,
      SessionStatus.Running,
      +1,
    );

    return await ctx.db.get(sessionId);
  },
});

export const update = mutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(sessionStatusValidator),
    endedAt: v.optional(v.union(v.number(), v.null())),
    exitCode: v.optional(v.number()),
    pid: v.optional(v.number()),
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

    // Build patch: filter out undefined args, but convert null → undefined
    // so Convex removes the field from the document (used for clearing endedAt).
    const patch: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(rest)) {
      if (val === undefined) continue;
      patch[key] = val === null ? undefined : val;
    }

    await ctx.db.patch(sessionId, patch);

    if (args.status !== undefined && args.status !== session.status) {
      await transitionStatusCount(
        ctx,
        session.projectId,
        CounterEntity.Sessions,
        session.status,
        args.status,
      );
    }

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

export const listByIssue = query({
  args: {
    issueId: v.id("issues"),
    type: v.optional(sessionTypeValidator),
    status: v.optional(sessionStatusValidator),
  },
  handler: async (ctx, args) => {
    let sessions = await ctx.db
      .query("sessions")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();

    if (args.type !== undefined) {
      sessions = sessions.filter((s) => s.type === args.type);
    }
    if (args.status !== undefined) {
      sessions = sessions.filter((s) => s.status === args.status);
    }

    return sessions.sort((a, b) => a.startedAt - b.startedAt);
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

    const issue = session.issueId ? await ctx.db.get(session.issueId) : null;
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
        const issue = session.issueId
          ? await ctx.db.get(session.issueId)
          : null;
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

/**
 * Count sessions for a project, grouped by status.
 * Exported for reuse by other queries (e.g. projects.listWithStats).
 *
 * Reads from the `statusCounts` counter table — O(1) per status bucket
 * instead of full index scans. FLUX-357.
 *
 * When `statuses` is provided, only those buckets are read.
 */
export async function countSessionsByStatus(
  db: DatabaseReader,
  projectId: Id<"projects">,
  statuses?: SessionStatusValue[],
): Promise<Record<string, number>> {
  return readStatusCounts(
    db,
    projectId,
    CounterEntity.Sessions,
    statuses ?? Object.values(SessionStatus),
  );
}

/**
 * Get the most recently started running session for a project, enriched with
 * issue shortId/title/priority/status. Returns null when no session is running.
 *
 * Used by the Activity page to track the active session in real-time.
 */
export const getActiveWithIssue = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_project_status_startedAt", (q) =>
        q.eq("projectId", args.projectId).eq("status", SessionStatus.Running),
      )
      .order("desc")
      .first();

    if (!session) return null;

    const issue = session.issueId ? await ctx.db.get(session.issueId) : null;
    return {
      ...session,
      issueShortId: issue?.shortId ?? null,
      issueTitle: issue?.title ?? null,
      issuePriority: issue?.priority ?? null,
      issueStatus: issue?.status ?? null,
    };
  },
});

export const counts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return countSessionsByStatus(ctx.db, args.projectId);
  },
});

/**
 * Recent completed/failed sessions for a project — used by the planner prompt
 * to understand recent activity and outcomes.
 */
export const recentForProject = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_project_startedAt", (q) =>
        q.eq("projectId", args.projectId),
      )
      .order("desc")
      .take(limit);

    // Enrich with issue shortId where available
    return await Promise.all(
      sessions.map(async (session) => {
        const issue = session.issueId
          ? await ctx.db.get(session.issueId)
          : null;
        return {
          type: session.type,
          phase: session.phase ?? null,
          status: session.status,
          disposition: session.disposition ?? null,
          note: session.note ?? null,
          startedAt: session.startedAt,
          issueShortId: issue?.shortId ?? null,
        };
      }),
    );
  },
});
