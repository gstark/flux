import type { ConvexClient } from "convex/browser";
import type { z } from "zod";
import { api } from "$convex/_generated/api";
import type { Id } from "$convex/_generated/dataModel";
import { SessionEventDirection, SessionStatus } from "$convex/schema";
import type { ProjectRunner } from "../orchestrator";
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
  IssuesListBySessionSchema,
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
  PromptsSetRetroSchema,
  PromptsSetReviewSchema,
  PromptsSetWorkSchema,
  SessionsListSchema,
  SessionsShowSchema,
} from "./schema";

export type ToolContext = {
  convex: ConvexClient;
  projectId: Id<"projects">;
  projectSlug: string;
  /** Returns the ProjectRunner if the project is enabled, undefined otherwise. */
  getRunner: () => ProjectRunner | undefined;
  /** Current session ID if called from within an agent session, undefined otherwise. */
  sessionId?: Id<"sessions">;
  /** Agent name if called from within an agent session, undefined otherwise. */
  agentName?: string;
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
 *
 * All handlers are wrapped in a catch-all that converts thrown errors into
 * structured `{ error, _meta }` responses, so individual handlers never need
 * their own try/catch.
 */
function typedHandler<S extends z.ZodType>(
  schema: S,
  fn: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>,
): ToolHandler {
  return async (args, ctx) => {
    try {
      return await fn(schema.parse(args), ctx);
    } catch (err) {
      return error(ctx, errMsg(err));
    }
  };
}

/**
 * Wraps a bare ToolHandler (no schema) with the same catch-all error handling
 * as `typedHandler`. Use for handlers that take no meaningful arguments.
 */
function safeHandler(
  fn: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>,
): ToolHandler {
  return async (args, ctx) => {
    try {
      return await fn(args, ctx);
    } catch (err) {
      return error(ctx, errMsg(err));
    }
  };
}

function buildMeta(ctx: ToolContext) {
  const runner = ctx.getRunner();
  const status = runner?.getStatus();
  return {
    project: ctx.projectSlug,
    timestamp: Date.now(),
    orchestrator_status: status?.state ?? "disabled",
    active_session: status?.activeSession?.sessionId ?? null,
  };
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

function error(ctx: ToolContext, message: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, _meta: buildMeta(ctx) }),
      },
    ],
    isError: true,
  };
}

/** Extract a human-readable message from an unknown catch value. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function looksLikeShortIssueId(value: string): boolean {
  return /^[A-Za-z]+-\d+$/.test(value.trim());
}

async function resolveIssueId(
  ctx: ToolContext,
  issueIdOrShortId: string,
): Promise<Id<"issues">> {
  const candidate = issueIdOrShortId.trim();
  if (!looksLikeShortIssueId(candidate)) {
    return candidate as Id<"issues">;
  }

  const normalizedShortId = candidate.toUpperCase();
  const matches = await ctx.convex.query(api.issues.search, {
    projectId: ctx.projectId,
    query: normalizedShortId,
    limit: 10,
  });
  const exactMatch = matches.find(
    (issue) => issue.shortId.toUpperCase() === normalizedShortId,
  );
  if (!exactMatch) {
    throw new Error(
      `Issue not found for short ID ${normalizedShortId}. Use issues_search to confirm the issue exists in this project.`,
    );
  }
  return exactMatch._id;
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
      ...(ctx.sessionId && { createdInSessionId: ctx.sessionId }),
      ...(ctx.agentName && { createdByAgent: ctx.agentName }),
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
  const resolvedIssueId = await resolveIssueId(ctx, issueId);
  const issue = await ctx.convex.query(api.issues.get, {
    issueId: resolvedIssueId,
  });
  if (!issue) {
    return error(
      ctx,
      `Issue not found: ${issueId}. Use issues_search to confirm the issue exists in this project.`,
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
    const runner = ctx.getRunner();
    if (!runner) {
      return error(
        ctx,
        "No runner for this project. Does the project have a valid path?",
      );
    }
    const result = await runner.run(issueId as Id<"issues">);
    return ok(ctx, {
      session: { sessionId: result.sessionId, pid: result.pid },
    });
  },
);

const orchestrator_kill: ToolHandler = safeHandler(async (_args, ctx) => {
  const runner = ctx.getRunner();
  if (!runner) {
    return ok(ctx, { message: "No runner active." });
  }
  await runner.kill();
  return ok(ctx, { message: "Session killed." });
});

const orchestrator_status: ToolHandler = safeHandler(async (_args, ctx) => {
  const runner = ctx.getRunner();
  if (!runner) {
    return ok(ctx, {
      status: { state: "disabled", readyCount: 0, activeSession: null },
    });
  }
  const status = runner.getStatus();
  return ok(ctx, { status });
});

const sessions_list = typedHandler(
  SessionsListSchema,
  async ({ status, limit }, ctx) => {
    const sessions = await ctx.convex.query(api.sessions.list, {
      projectId: ctx.projectId,
      status,
      limit,
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
        ctx,
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
    const runner = ctx.getRunner();
    const status = runner?.getStatus();
    if (
      runner &&
      session.status === SessionStatus.Running &&
      status?.activeSession?.sessionId === sessionId
    ) {
      const monitor = runner.getActiveMonitor();
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
    const updated = await ctx.convex.mutation(api.issues.close, {
      issueId: issueId as Id<"issues">,
      closeType,
      closeReason: reason,
    });
    return ok(ctx, { issue: updated });
  },
);

const issues_retry = typedHandler(
  IssuesRetrySchema,
  async ({ issueId }, ctx) => {
    const updated = await ctx.convex.mutation(api.issues.retry, {
      issueId: issueId as Id<"issues">,
    });
    return ok(ctx, { issue: updated });
  },
);

const issues_defer = typedHandler(
  IssuesDeferSchema,
  async ({ issueId, note }, ctx) => {
    const updated = await ctx.convex.mutation(api.issues.defer, {
      issueId: issueId as Id<"issues">,
      note,
    });
    return ok(ctx, { issue: updated });
  },
);

const issues_undefer = typedHandler(
  IssuesUndeferSchema,
  async ({ issueId, note }, ctx) => {
    const updated = await ctx.convex.mutation(api.issues.undefer, {
      issueId: issueId as Id<"issues">,
      note,
    });
    return ok(ctx, { issue: updated });
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

const issues_list_by_session = typedHandler(
  IssuesListBySessionSchema,
  async ({ sessionId }, ctx) => {
    const issues = await ctx.convex.query(api.issues.listBySession, {
      sessionId: sessionId as Id<"sessions">,
    });
    const summary = issues.map(
      ({ description: _description, ...rest }) => rest,
    );
    return ok(ctx, { issues: summary, count: summary.length });
  },
);

const comments_create = typedHandler(
  CommentsCreateSchema,
  async ({ issueId, content, author }, ctx) => {
    const resolvedIssueId = await resolveIssueId(ctx, issueId);
    const commentId = await ctx.convex.mutation(api.comments.create, {
      issueId: resolvedIssueId,
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
      ...(ctx.sessionId && { createdInSessionId: ctx.sessionId }),
      ...(ctx.agentName && { createdByAgent: ctx.agentName }),
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
    const resolvedIssueId = await resolveIssueId(ctx, issueId);
    const comments = await ctx.convex.query(api.comments.list, {
      issueId: resolvedIssueId,
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
      ctx,
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
    const updated = await ctx.convex.mutation(api.epics.close, {
      epicId: epicId as Id<"epics">,
      closeReason: reason,
    });
    return ok(ctx, { epic: updated });
  },
);

const deps_add = typedHandler(
  DepsAddSchema,
  async ({ blockerId, blockedId }, ctx) => {
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
  },
);

const deps_remove = typedHandler(
  DepsRemoveSchema,
  async ({ blockerId, blockedId }, ctx) => {
    const result = await ctx.convex.mutation(api.deps.remove, {
      blockerId: blockerId as Id<"issues">,
      blockedId: blockedId as Id<"issues">,
    });
    return ok(ctx, { removed: result.deleted });
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

const labels_list: ToolHandler = safeHandler(async (_args, ctx) => {
  const labels = await ctx.convex.query(api.labels.list, {
    projectId: ctx.projectId,
  });
  return ok(ctx, { labels, count: labels.length });
});

const labels_create = typedHandler(
  LabelsCreateSchema,
  async ({ name, color }, ctx) => {
    const labelId = await ctx.convex.mutation(api.labels.create, {
      projectId: ctx.projectId,
      name,
      color,
    });
    return ok(ctx, { labelId, name, color });
  },
);

const labels_update = typedHandler(
  LabelsUpdateSchema,
  async ({ labelId, ...updates }, ctx) => {
    const updated = await ctx.convex.mutation(api.labels.update, {
      labelId: labelId as Id<"labels">,
      ...updates,
    });
    return ok(ctx, { label: updated });
  },
);

const labels_delete = typedHandler(
  LabelsDeleteSchema,
  async ({ labelId }, ctx) => {
    await ctx.convex.mutation(api.labels.remove, {
      labelId: labelId as Id<"labels">,
    });
    return ok(ctx, { deleted: labelId });
  },
);

// ── Prompts ──────────────────────────────────────────────────────────

const prompts_set_work = typedHandler(
  PromptsSetWorkSchema,
  async ({ prompt }, ctx) => {
    // Always pass the prompt value - empty string effectively clears it
    await ctx.convex.mutation(api.projects.update, {
      projectId: ctx.projectId,
      workPrompt: prompt,
    });
    return ok(ctx, {
      message: prompt
        ? "Work prompt updated"
        : "Work prompt cleared (using default)",
      prompt: prompt || null,
    });
  },
);

const prompts_set_retro = typedHandler(
  PromptsSetRetroSchema,
  async ({ prompt }, ctx) => {
    // Always pass the prompt value - empty string effectively clears it
    await ctx.convex.mutation(api.projects.update, {
      projectId: ctx.projectId,
      retroPrompt: prompt,
    });
    return ok(ctx, {
      message: prompt
        ? "Retro prompt updated"
        : "Retro prompt cleared (using default)",
      prompt: prompt || null,
    });
  },
);

const prompts_set_review = typedHandler(
  PromptsSetReviewSchema,
  async ({ prompt }, ctx) => {
    // Always pass the prompt value - empty string effectively clears it
    await ctx.convex.mutation(api.projects.update, {
      projectId: ctx.projectId,
      reviewPrompt: prompt,
    });
    return ok(ctx, {
      message: prompt
        ? "Review prompt updated"
        : "Review prompt cleared (using default)",
      prompt: prompt || null,
    });
  },
);

const prompts_get: ToolHandler = safeHandler(async (_args, ctx) => {
  const project = await ctx.convex.query(api.projects.getById, {
    projectId: ctx.projectId,
  });
  if (!project) {
    return error(ctx, "Project not found");
  }
  return ok(ctx, {
    prompts: {
      work: project.workPrompt ?? null,
      retro: project.retroPrompt ?? null,
      review: project.reviewPrompt ?? null,
    },
  });
});

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
  issues_retry,
  issues_search,
  issues_list_by_session,
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
  sessions_list,
  sessions_show,
  prompts_set_work,
  prompts_set_retro,
  prompts_set_review,
  prompts_get,
};
