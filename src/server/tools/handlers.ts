import type { ConvexClient } from "convex/browser";
import type { z } from "zod";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import {
  CommentAuthor,
  IssueStatus,
  SessionEventDirection,
  SessionStatus,
} from "$convex/schema";
import type { Orchestrator } from "../orchestrator";
import {
  CommentsCreateSchema,
  CommentsListSchema,
  DepsAddSchema,
  DepsListForIssueSchema,
  DepsRemoveSchema,
  EpicsCloseSchema,
  EpicsCreateSchema,
  EpicsListSchema,
  EpicsShowSchema,
  EpicsUpdateSchema,
  IssuesBulkCreateSchema,
  IssuesBulkUpdateSchema,
  IssuesCloseSchema,
  IssuesCreateSchema,
  IssuesDeferSchema,
  IssuesGetSchema,
  IssuesListSchema,
  IssuesReadySchema,
  IssuesRetrySchema,
  IssuesSearchSchema,
  IssuesUndeferSchema,
  IssuesUpdateSchema,
  LabelsCreateSchema,
  LabelsDeleteSchema,
  LabelsUpdateSchema,
  OrchestratorRunSchema,
  SessionsListSchema,
  SessionsShowSchema,
} from "./schema";

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

/**
 * Creates a ToolHandler with args typed via the Zod schema's inferred type.
 * The MCP SDK validates args before our handler runs, so the parse() here is
 * defense-in-depth — it will fail fast if something slips past the SDK layer
 * rather than silently operating on malformed data.
 */
function typedHandler<S extends z.ZodType>(
  schema: S,
  fn: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>,
): ToolHandler {
  return (args, ctx) => fn(schema.parse(args), ctx);
}

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

const issues_create = typedHandler(
  IssuesCreateSchema,
  async ({ title, description, priority }, ctx) => {
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
  },
);

const issues_list = typedHandler(
  IssuesListSchema,
  async ({ status, limit }, ctx) => {
    const issues = await ctx.convex.query(api.issues.list, {
      projectId: ctx.projectId,
      status,
      limit: Math.min(limit ?? 50, 200),
    });
    // Strip descriptions from list (token efficiency)
    const summary = issues.map(
      ({ description: _description, ...rest }) => rest,
    );
    return ok(ctx, { issues: summary, count: summary.length });
  },
);

const issues_get = typedHandler(IssuesGetSchema, async ({ issueId }, ctx) => {
  const issue = await ctx.convex.query(api.issues.get, {
    issueId: issueId as Id<"issues">,
  });
  if (!issue) {
    return error(
      `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
    );
  }
  return ok(ctx, { issue });
});

const issues_update = typedHandler(
  IssuesUpdateSchema,
  async ({ issueId, ...updates }, ctx) => {
    const updated = await ctx.convex.mutation(api.issues.update, {
      issueId: issueId as Id<"issues">,
      ...updates,
    });
    return ok(ctx, { issue: updated });
  },
);

const issues_ready = typedHandler(IssuesReadySchema, async ({ limit }, ctx) => {
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
});

const orchestrator_run = typedHandler(
  OrchestratorRunSchema,
  async ({ issueId }, ctx) => {
    try {
      const orchestrator = ctx.getOrchestrator();
      const result = await orchestrator.run(issueId as Id<"issues">);
      return ok(ctx, {
        session: { sessionId: result.sessionId, pid: result.pid },
      });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

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

const sessions_list = typedHandler(
  SessionsListSchema,
  async ({ status }, ctx) => {
    const sessions = await ctx.convex.query(api.sessions.list, {
      projectId: ctx.projectId,
      status,
    });
    return ok(ctx, { sessions, count: sessions.length });
  },
);

const sessions_show = typedHandler(
  SessionsShowSchema,
  async ({ sessionId }, ctx) => {
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
      session.status === SessionStatus.Running &&
      status.activeSession?.sessionId === sessionId
    ) {
      const monitor = orchestrator.getActiveMonitor();
      if (monitor) {
        const now = Date.now();
        lines = monitor.buffer.getRecent(100).map((content, i) => ({
          sequence: i,
          direction: SessionEventDirection.Output,
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
  },
);

const issues_close = typedHandler(
  IssuesCloseSchema,
  async ({ issueId, closeType, reason }, ctx) => {
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
  },
);

const issues_retry = typedHandler(
  IssuesRetrySchema,
  async ({ issueId }, ctx) => {
    try {
      const updated = await ctx.convex.mutation(api.issues.retry, {
        issueId: issueId as Id<"issues">,
      });
      return ok(ctx, { issue: updated });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const issues_defer = typedHandler(
  IssuesDeferSchema,
  async ({ issueId, note }, ctx) => {
    try {
      const issue = await ctx.convex.query(api.issues.get, {
        issueId: issueId as Id<"issues">,
      });
      if (!issue) {
        return error(
          `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
        );
      }
      if (issue.status === IssueStatus.Deferred) {
        return error(`Issue ${issue.shortId} is already deferred.`);
      }
      if (issue.status === IssueStatus.Closed) {
        return error(`Cannot defer a closed issue (${issue.shortId}).`);
      }

      const updated = await ctx.convex.mutation(api.issues.update, {
        issueId: issueId as Id<"issues">,
        status: IssueStatus.Deferred,
      });
      await ctx.convex.mutation(api.comments.create, {
        issueId: issueId as Id<"issues">,
        content: `Deferred: ${note}`,
        author: CommentAuthor.Flux,
      });
      return ok(ctx, { issue: updated });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const issues_undefer = typedHandler(
  IssuesUndeferSchema,
  async ({ issueId, note }, ctx) => {
    try {
      const issue = await ctx.convex.query(api.issues.get, {
        issueId: issueId as Id<"issues">,
      });
      if (!issue) {
        return error(
          `Issue not found: ${issueId}. Use issues_list to find valid IDs.`,
        );
      }
      if (issue.status !== IssueStatus.Deferred) {
        return error(
          `Issue ${issue.shortId} is not deferred (status: ${issue.status}).`,
        );
      }

      const updated = await ctx.convex.mutation(api.issues.update, {
        issueId: issueId as Id<"issues">,
        status: IssueStatus.Open,
      });
      await ctx.convex.mutation(api.comments.create, {
        issueId: issueId as Id<"issues">,
        content: `Undeferred: ${note}`,
        author: CommentAuthor.Flux,
      });
      return ok(ctx, { issue: updated });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const issues_search = typedHandler(
  IssuesSearchSchema,
  async ({ query, limit }, ctx) => {
    const issues = await ctx.convex.query(api.issues.search, {
      projectId: ctx.projectId,
      query,
      limit: Math.min(limit ?? 20, 100),
    });
    const summary = issues.map(
      ({ description: _description, ...rest }) => rest,
    );
    return ok(ctx, { issues: summary, count: summary.length, query });
  },
);

const comments_create = typedHandler(
  CommentsCreateSchema,
  async ({ issueId, content, author }, ctx) => {
    const commentId = await ctx.convex.mutation(api.comments.create, {
      issueId: issueId as Id<"issues">,
      content,
      author,
    });
    return ok(ctx, { commentId });
  },
);

const issues_bulk_create = typedHandler(
  IssuesBulkCreateSchema,
  async ({ issues }, ctx) => {
    const created = await ctx.convex.mutation(api.issues.bulkCreate, {
      projectId: ctx.projectId,
      issues,
    });
    return ok(ctx, { issues: created, count: created.length });
  },
);

const issues_bulk_update = typedHandler(
  IssuesBulkUpdateSchema,
  async ({ updates }, ctx) => {
    const issues = await ctx.convex.mutation(api.issues.bulkUpdate, {
      updates: updates.map(({ issueId, ...fields }) => ({
        issueId: issueId as Id<"issues">,
        ...fields,
      })),
    });

    return ok(ctx, { issues, count: issues.length });
  },
);

const comments_list = typedHandler(
  CommentsListSchema,
  async ({ issueId, limit }, ctx) => {
    const comments = await ctx.convex.query(api.comments.list, {
      issueId: issueId as Id<"issues">,
      limit: Math.min(limit ?? 50, 200),
    });
    return ok(ctx, { comments, count: comments.length });
  },
);

const epics_list = typedHandler(
  EpicsListSchema,
  async ({ status, limit }, ctx) => {
    const epics = await ctx.convex.query(api.epics.list, {
      projectId: ctx.projectId,
      status,
      limit: Math.min(limit ?? 50, 200),
    });
    // Strip descriptions from list (token efficiency)
    const summary = epics.map(({ description: _description, ...rest }) => rest);
    return ok(ctx, { epics: summary, count: summary.length });
  },
);

const epics_create = typedHandler(
  EpicsCreateSchema,
  async ({ title, description }, ctx) => {
    const epicId = await ctx.convex.mutation(api.epics.create, {
      projectId: ctx.projectId,
      title,
      description,
    });
    const epic = await ctx.convex.query(api.epics.get, {
      epicId: epicId as Id<"epics">,
    });
    return ok(ctx, { epic });
  },
);

const epics_show = typedHandler(EpicsShowSchema, async ({ epicId }, ctx) => {
  const epic = await ctx.convex.query(api.epics.show, {
    epicId: epicId as Id<"epics">,
  });
  if (!epic) {
    return error(
      `Epic not found: ${epicId}. Use epics_list to find valid IDs.`,
    );
  }
  return ok(ctx, { epic });
});

const epics_update = typedHandler(
  EpicsUpdateSchema,
  async ({ epicId, ...updates }, ctx) => {
    const updated = await ctx.convex.mutation(api.epics.update, {
      epicId: epicId as Id<"epics">,
      ...updates,
    });
    return ok(ctx, { epic: updated });
  },
);

const epics_close = typedHandler(
  EpicsCloseSchema,
  async ({ epicId, reason }, ctx) => {
    try {
      const updated = await ctx.convex.mutation(api.epics.close, {
        epicId: epicId as Id<"epics">,
        closeReason: reason,
      });
      return ok(ctx, { epic: updated });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const deps_add = typedHandler(
  DepsAddSchema,
  async ({ blockerId, blockedId }, ctx) => {
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
  },
);

const deps_remove = typedHandler(
  DepsRemoveSchema,
  async ({ blockerId, blockedId }, ctx) => {
    try {
      const result = await ctx.convex.mutation(api.deps.remove, {
        blockerId: blockerId as Id<"issues">,
        blockedId: blockedId as Id<"issues">,
      });
      return ok(ctx, { removed: result.deleted });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const deps_listForIssue = typedHandler(
  DepsListForIssueSchema,
  async ({ issueId }, ctx) => {
    const result = await ctx.convex.query(api.deps.listForIssue, {
      issueId: issueId as Id<"issues">,
    });
    return ok(ctx, {
      blockers: result.blockers,
      blocks: result.blocks,
      blockerCount: result.blockers.length,
      blocksCount: result.blocks.length,
    });
  },
);

// ── Labels ────────────────────────────────────────────────────────────

const labels_list: ToolHandler = async (_args, ctx) => {
  const labels = await ctx.convex.query(api.labels.list, {
    projectId: ctx.projectId,
  });
  return ok(ctx, { labels, count: labels.length });
};

const labels_create = typedHandler(
  LabelsCreateSchema,
  async ({ name, color }, ctx) => {
    try {
      const labelId = await ctx.convex.mutation(api.labels.create, {
        projectId: ctx.projectId,
        name,
        color,
      });
      return ok(ctx, { labelId, name, color });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const labels_update = typedHandler(
  LabelsUpdateSchema,
  async ({ labelId, ...updates }, ctx) => {
    try {
      const updated = await ctx.convex.mutation(api.labels.update, {
        labelId: labelId as Id<"labels">,
        ...updates,
      });
      return ok(ctx, { label: updated });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

const labels_delete = typedHandler(
  LabelsDeleteSchema,
  async ({ labelId }, ctx) => {
    try {
      await ctx.convex.mutation(api.labels.remove, {
        labelId: labelId as Id<"labels">,
      });
      return ok(ctx, { deleted: labelId });
    } catch (err) {
      return error(String(err instanceof Error ? err.message : err));
    }
  },
);

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
  issues_unstick: issues_retry,
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
  labels_list,
  labels_create,
  labels_update,
  labels_delete,
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
