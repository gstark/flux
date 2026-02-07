import type { ConvexClient } from "convex/browser";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import type { Orchestrator } from "../orchestrator";

export type ToolContext = {
  convex: ConvexClient;
  projectId: Id<"projects">;
  projectSlug: string;
  getOrchestrator: () => Orchestrator;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

function buildMeta(ctx: ToolContext) {
  return { project: ctx.projectSlug, timestamp: Date.now() };
}

function ok(ctx: ToolContext, data: Record<string, unknown>): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ...data, _meta: buildMeta(ctx) }),
      },
    ],
  };
}

function error(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ── Handlers ──────────────────────────────────────────────────────────

const issues_create: ToolHandler = async (args, ctx) => {
  const { title, description, priority } = args as {
    title: string;
    description?: string;
    priority?: "critical" | "high" | "medium" | "low";
  };

  const issueId = await ctx.convex.mutation(api.issues.create, {
    projectId: ctx.projectId,
    title,
    description,
    priority,
  });
  const issue = await ctx.convex.query(api.issues.get, {
    issueId: issueId as Id<"issues">,
  });
  return ok(ctx, { issue });
};

const issues_list: ToolHandler = async (args, ctx) => {
  const { status, limit } = args as {
    status?: "open" | "in_progress" | "closed" | "deferred" | "stuck";
    limit?: number;
  };

  const issues = await ctx.convex.query(api.issues.list, {
    projectId: ctx.projectId,
    status,
    limit: Math.min(limit ?? 50, 200),
  });
  // Strip descriptions from list (token efficiency)
  const summary = issues.map(({ description: _description, ...rest }) => rest);
  return ok(ctx, { issues: summary, count: summary.length });
};

const issues_get: ToolHandler = async (args, ctx) => {
  const { issueId } = args as { issueId: string };

  const issue = await ctx.convex.query(api.issues.get, {
    issueId: issueId as Id<"issues">,
  });
  if (!issue) {
    return error(
      `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
    );
  }
  return ok(ctx, { issue });
};

const issues_update: ToolHandler = async (args, ctx) => {
  const { issueId, ...updates } = args as {
    issueId: string;
    title?: string;
    description?: string;
    status?: "open" | "in_progress" | "closed" | "deferred" | "stuck";
    priority?: "critical" | "high" | "medium" | "low";
    assignee?: string;
  };

  const updated = await ctx.convex.mutation(api.issues.update, {
    issueId: issueId as Id<"issues">,
    ...updates,
  });
  return ok(ctx, { issue: updated });
};

const issues_ready: ToolHandler = async (args, ctx) => {
  const { limit } = args as { limit?: number };

  // Fetch config for maxFailures
  const config = await ctx.convex.query(api.orchestratorConfig.get, {
    projectId: ctx.projectId,
  });
  const maxFailures = config?.maxFailures ?? 3;

  const issues = await ctx.convex.query(api.issues.ready, {
    projectId: ctx.projectId,
    maxFailures,
  });

  const capped = issues.slice(0, Math.min(limit ?? 50, 200));
  const summary = capped.map(({ description: _description, ...rest }) => rest);
  return ok(ctx, { issues: summary, count: summary.length, maxFailures });
};

const orchestrator_run: ToolHandler = async (args, ctx) => {
  const { issueId } = args as { issueId: string };

  try {
    const orchestrator = ctx.getOrchestrator();
    const result = await orchestrator.run(issueId as Id<"issues">);
    return ok(ctx, {
      session: { sessionId: result.sessionId, pid: result.pid },
    });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const orchestrator_kill: ToolHandler = async (_args, ctx) => {
  try {
    const orchestrator = ctx.getOrchestrator();
    await orchestrator.kill();
    return ok(ctx, { message: "Session killed." });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const orchestrator_status: ToolHandler = async (_args, ctx) => {
  const orchestrator = ctx.getOrchestrator();
  const status = orchestrator.getStatus();
  return ok(ctx, { status });
};

const orchestrator_enable: ToolHandler = async (_args, ctx) => {
  try {
    const orchestrator = ctx.getOrchestrator();
    await orchestrator.enable();
    const status = orchestrator.getStatus();
    return ok(ctx, { status });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const orchestrator_stop: ToolHandler = async (_args, ctx) => {
  try {
    const orchestrator = ctx.getOrchestrator();
    await orchestrator.stop();
    const status = orchestrator.getStatus();
    return ok(ctx, { status });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const sessions_list: ToolHandler = async (args, ctx) => {
  const { status } = args as {
    status?: "running" | "completed" | "failed";
  };

  const sessions = await ctx.convex.query(api.sessions.list, {
    projectId: ctx.projectId,
    status,
  });
  return ok(ctx, { sessions, count: sessions.length });
};

const sessions_show: ToolHandler = async (args, ctx) => {
  const { sessionId } = args as { sessionId: string };

  const session = await ctx.convex.query(api.sessions.get, {
    sessionId: sessionId as Id<"sessions">,
  });
  if (!session) {
    return error(
      `Session not found: ${sessionId}. Use sessions_list to find valid IDs.`,
    );
  }

  let lines: Array<{
    sequence: number;
    direction: string;
    content: string;
    timestamp: number;
  }> = [];

  // For the active running session, read from in-memory buffer
  const orchestrator = ctx.getOrchestrator();
  const status = orchestrator.getStatus();
  if (
    session.status === "running" &&
    status.activeSession?.sessionId === sessionId
  ) {
    const monitor = orchestrator.getActiveMonitor();
    if (monitor) {
      const now = Date.now();
      lines = monitor.buffer.getRecent(100).map((content, i) => ({
        sequence: i,
        direction: "output" as const,
        content,
        timestamp: now,
      }));
    }
  } else {
    // For completed/failed sessions, read from Convex history
    const events = await ctx.convex.query(api.sessionEvents.recent, {
      sessionId: sessionId as Id<"sessions">,
      limit: 100,
    });
    lines = events.map((e) => ({
      sequence: e.sequence,
      direction: e.direction,
      content: e.content,
      timestamp: e.timestamp,
    }));
  }

  return ok(ctx, {
    session,
    transcript: {
      lines,
      totalLines: lines.length,
      showing: `last ${lines.length} lines`,
    },
  });
};

const issues_close: ToolHandler = async (args, ctx) => {
  const { issueId, closeType, reason } = args as {
    issueId: string;
    closeType: "completed" | "noop" | "duplicate" | "wontfix";
    reason?: string;
  };

  try {
    const updated = await ctx.convex.mutation(api.issues.close, {
      issueId: issueId as Id<"issues">,
      closeType,
      closeReason: reason,
    });
    return ok(ctx, { issue: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const issues_unstick: ToolHandler = async (args, ctx) => {
  const { issueId } = args as { issueId: string };

  try {
    const updated = await ctx.convex.mutation(api.issues.unstick, {
      issueId: issueId as Id<"issues">,
    });
    return ok(ctx, { issue: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const issues_retry: ToolHandler = async (args, ctx) => {
  const { issueId } = args as { issueId: string };

  try {
    const updated = await ctx.convex.mutation(api.issues.retry, {
      issueId: issueId as Id<"issues">,
    });
    return ok(ctx, { issue: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const issues_defer: ToolHandler = async (args, ctx) => {
  const { issueId, note } = args as { issueId: string; note: string };

  try {
    const issue = await ctx.convex.query(api.issues.get, {
      issueId: issueId as Id<"issues">,
    });
    if (!issue) {
      return error(
        `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
      );
    }
    if (issue.status === "deferred") {
      return error(`Issue ${issue.shortId} is already deferred.`);
    }
    if (issue.status === "closed") {
      return error(`Cannot defer a closed issue (${issue.shortId}).`);
    }

    const updated = await ctx.convex.mutation(api.issues.update, {
      issueId: issueId as Id<"issues">,
      status: "deferred",
    });
    await ctx.convex.mutation(api.comments.create, {
      issueId: issueId as Id<"issues">,
      content: `Deferred: ${note}`,
      author: "flux",
    });
    return ok(ctx, { issue: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const issues_undefer: ToolHandler = async (args, ctx) => {
  const { issueId, note } = args as { issueId: string; note: string };

  try {
    const issue = await ctx.convex.query(api.issues.get, {
      issueId: issueId as Id<"issues">,
    });
    if (!issue) {
      return error(
        `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
      );
    }
    if (issue.status !== "deferred") {
      return error(
        `Issue ${issue.shortId} is not deferred (status: ${issue.status}).`,
      );
    }

    const updated = await ctx.convex.mutation(api.issues.update, {
      issueId: issueId as Id<"issues">,
      status: "open",
    });
    await ctx.convex.mutation(api.comments.create, {
      issueId: issueId as Id<"issues">,
      content: `Undeferred: ${note}`,
      author: "flux",
    });
    return ok(ctx, { issue: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const issues_search: ToolHandler = async (args, ctx) => {
  const { query, limit } = args as { query: string; limit?: number };

  const issues = await ctx.convex.query(api.issues.search, {
    projectId: ctx.projectId,
    query,
    limit: Math.min(limit ?? 20, 100),
  });
  const summary = issues.map(({ description: _description, ...rest }) => rest);
  return ok(ctx, { issues: summary, count: summary.length, query });
};

const comments_create: ToolHandler = async (args, ctx) => {
  const { issueId, content, author } = args as {
    issueId: string;
    content: string;
    author?: "user" | "agent" | "flux";
  };

  const commentId = await ctx.convex.mutation(api.comments.create, {
    issueId: issueId as Id<"issues">,
    content,
    author,
  });
  return ok(ctx, { commentId });
};

const issues_bulk_create: ToolHandler = async (args, ctx) => {
  const { issues } = args as {
    issues: Array<{
      title: string;
      description?: string;
      priority?: "critical" | "high" | "medium" | "low";
    }>;
  };

  const created = await ctx.convex.mutation(api.issues.bulkCreate, {
    projectId: ctx.projectId,
    issues,
  });
  return ok(ctx, { issues: created, count: created.length });
};

const issues_bulk_update: ToolHandler = async (args, ctx) => {
  const { updates } = args as {
    updates: Array<{
      issueId: string;
      status?: "open" | "in_progress" | "closed" | "deferred" | "stuck";
      priority?: "critical" | "high" | "medium" | "low";
    }>;
  };

  const results = await Promise.allSettled(
    updates.map((update) => {
      const { issueId, ...fields } = update;
      return ctx.convex.mutation(api.issues.update, {
        issueId: issueId as Id<"issues">,
        ...fields,
      });
    }),
  );

  const succeeded: unknown[] = [];
  const failed: { issueId: string; error: string }[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      succeeded.push(result.value);
    } else {
      failed.push({
        issueId: updates[i]!.issueId,
        error: String(
          result.reason instanceof Error
            ? result.reason.message
            : result.reason,
        ),
      });
    }
  }

  if (failed.length > 0 && succeeded.length === 0) {
    return error(
      `All ${failed.length} updates failed. First error: ${failed[0]!.error}`,
    );
  }

  return ok(ctx, {
    issues: succeeded,
    count: succeeded.length,
    ...(failed.length > 0 ? { failed, failedCount: failed.length } : {}),
  });
};

const comments_list: ToolHandler = async (args, ctx) => {
  const { issueId, limit } = args as { issueId: string; limit?: number };

  const comments = await ctx.convex.query(api.comments.list, {
    issueId: issueId as Id<"issues">,
    limit: Math.min(limit ?? 50, 200),
  });
  return ok(ctx, { comments, count: comments.length });
};

const epics_list: ToolHandler = async (args, ctx) => {
  const { status, limit } = args as {
    status?: "open" | "closed";
    limit?: number;
  };

  const epics = await ctx.convex.query(api.epics.list, {
    projectId: ctx.projectId,
    status,
    limit: Math.min(limit ?? 50, 200),
  });
  // Strip descriptions from list (token efficiency)
  const summary = epics.map(({ description: _description, ...rest }) => rest);
  return ok(ctx, { epics: summary, count: summary.length });
};

const epics_create: ToolHandler = async (args, ctx) => {
  const { title, description } = args as {
    title: string;
    description?: string;
  };

  const epicId = await ctx.convex.mutation(api.epics.create, {
    projectId: ctx.projectId,
    title,
    description,
  });
  const epic = await ctx.convex.query(api.epics.get, {
    epicId: epicId as Id<"epics">,
  });
  return ok(ctx, { epic });
};

const epics_show: ToolHandler = async (args, ctx) => {
  const { epicId } = args as { epicId: string };

  const epic = await ctx.convex.query(api.epics.show, {
    epicId: epicId as Id<"epics">,
  });
  if (!epic) {
    return error(
      `Epic not found: ${epicId}. Use epics_list to find valid IDs.`,
    );
  }
  return ok(ctx, { epic });
};

const epics_update: ToolHandler = async (args, ctx) => {
  const { epicId, ...updates } = args as {
    epicId: string;
    title?: string;
    description?: string;
  };

  const updated = await ctx.convex.mutation(api.epics.update, {
    epicId: epicId as Id<"epics">,
    ...updates,
  });
  return ok(ctx, { epic: updated });
};

const epics_close: ToolHandler = async (args, ctx) => {
  const { epicId, reason } = args as {
    epicId: string;
    reason?: string;
  };

  try {
    const updated = await ctx.convex.mutation(api.epics.close, {
      epicId: epicId as Id<"epics">,
      closeReason: reason,
    });
    return ok(ctx, { epic: updated });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const deps_add: ToolHandler = async (args, ctx) => {
  const { blockerId, blockedId } = args as {
    blockerId: string;
    blockedId: string;
  };

  try {
    const depId = await ctx.convex.mutation(api.deps.add, {
      blockerId: blockerId as Id<"issues">,
      blockedId: blockedId as Id<"issues">,
    });
    // Fetch both issues for a useful response
    const [blocker, blocked] = await Promise.all([
      ctx.convex.query(api.issues.get, {
        issueId: blockerId as Id<"issues">,
      }),
      ctx.convex.query(api.issues.get, {
        issueId: blockedId as Id<"issues">,
      }),
    ]);
    return ok(ctx, {
      dependency: {
        depId,
        blocker: { issueId: blockerId, shortId: blocker?.shortId },
        blocked: { issueId: blockedId, shortId: blocked?.shortId },
      },
    });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const deps_remove: ToolHandler = async (args, ctx) => {
  const { blockerId, blockedId } = args as {
    blockerId: string;
    blockedId: string;
  };

  try {
    const result = await ctx.convex.mutation(api.deps.remove, {
      blockerId: blockerId as Id<"issues">,
      blockedId: blockedId as Id<"issues">,
    });
    return ok(ctx, { removed: result.deleted });
  } catch (err) {
    return error(String(err instanceof Error ? err.message : err));
  }
};

const deps_listForIssue: ToolHandler = async (args, ctx) => {
  const { issueId } = args as { issueId: string };

  const result = await ctx.convex.query(api.deps.listForIssue, {
    issueId: issueId as Id<"issues">,
  });
  return ok(ctx, {
    blockers: result.blockers,
    blocks: result.blocks,
    blockerCount: result.blockers.length,
    blocksCount: result.blocks.length,
  });
};

// ── Export all implemented handlers ───────────────────────────────────

export const handlers: Record<string, ToolHandler> = {
  issues_create,
  issues_list,
  issues_get,
  issues_update,
  issues_close,
  issues_ready,
  issues_defer,
  issues_undefer,
  issues_unstick,
  issues_retry,
  issues_search,
  issues_bulk_create,
  issues_bulk_update,
  comments_create,
  comments_list,
  epics_list,
  epics_create,
  epics_show,
  epics_update,
  epics_close,
  deps_add,
  deps_remove,
  deps_listForIssue,
  orchestrator_run,
  orchestrator_kill,
  orchestrator_status,
  orchestrator_enable,
  orchestrator_stop,
  sessions_list,
  sessions_show,
};
