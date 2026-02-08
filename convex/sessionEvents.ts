import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { sessionEventDirectionValidator } from "./schema";

export const batchInsert = mutation({
  args: {
    sessionId: v.id("sessions"),
    events: v.array(
      v.object({
        direction: sessionEventDirectionValidator,
        content: v.string(),
        timestamp: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error(`Session ${args.sessionId} not found`);

    // Get highest sequence number for this session
    const lastEvent = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .first();

    let sequence = lastEvent ? lastEvent.sequence + 1 : 0;

    for (const event of args.events) {
      await ctx.db.insert("sessionEvents", {
        sessionId: args.sessionId,
        sequence: sequence++,
        direction: event.direction,
        content: event.content,
        timestamp: event.timestamp,
      });
    }

    return { count: args.events.length };
  },
});

export const recent = query({
  args: {
    sessionId: v.id("sessions"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 500);
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(limit);

    // Return in chronological order
    return events.reverse();
  },
});

export const listPaginated = query({
  args: {
    sessionId: v.id("sessions"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_sequence", (q) =>
        q.eq("sessionId", args.sessionId),
      )
      .paginate(args.paginationOpts);
  },
});
