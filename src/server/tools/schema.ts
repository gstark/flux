// Tool schema definitions — single source of truth for all MCP tool names, descriptions, and input schemas.
import { z } from "zod";
import {
  CloseType,
  CommentAuthor,
  EpicStatus,
  IssuePriority,
  IssueStatus,
  SessionStatus,
} from "$convex/schema";

// ── Derived Zod enums (single source of truth from Convex schema) ────
const issueStatusEnum = z.enum(
  Object.values(IssueStatus) as [string, ...string[]],
);
const issuePriorityEnum = z.enum(
  Object.values(IssuePriority) as [string, ...string[]],
);
const epicStatusEnum = z.enum(
  Object.values(EpicStatus) as [string, ...string[]],
);
const commentAuthorEnum = z.enum(
  Object.values(CommentAuthor) as [string, ...string[]],
);
const closeTypeEnum = z.enum(Object.values(CloseType) as [string, ...string[]]);
const sessionStatusEnum = z.enum(
  Object.values(SessionStatus) as [string, ...string[]],
);

// ── Derived TypeScript types for handler type assertions ─────────────
export type IssueStatusValue = (typeof IssueStatus)[keyof typeof IssueStatus];
export type IssuePriorityValue =
  (typeof IssuePriority)[keyof typeof IssuePriority];
export type EpicStatusValue = (typeof EpicStatus)[keyof typeof EpicStatus];
export type CommentAuthorValue =
  (typeof CommentAuthor)[keyof typeof CommentAuthor];
export type CloseTypeValue = (typeof CloseType)[keyof typeof CloseType];
export type SessionStatusValue =
  (typeof SessionStatus)[keyof typeof SessionStatus];

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodType>;
}

/**
 * Wraps a z.array() schema with preprocessing to handle MCP clients that
 * serialize complex arguments as JSON strings instead of native arrays.
 * Without this, Zod rejects the string with "expected array, received string".
 */
function jsonArray<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess((val) => {
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fall through — let Zod produce the validation error
      }
    }
    return val;
  }, z.array(itemSchema));
}

// ── Issues (implemented) ──────────────────────────────────────────────

const issues_create: ToolDef = {
  name: "issues_create",
  description:
    "Create a new issue in the project. Returns the created issue with its assigned shortId.",
  schema: {
    title: z.string().describe("Issue title. Be specific and actionable."),
    description: z
      .string()
      .optional()
      .describe("Detailed description. Supports markdown."),
    priority: issuePriorityEnum
      .optional()
      .describe(
        "Defaults to 'medium'. Use 'critical' only for drop-everything issues.",
      ),
  },
};

const issues_list: ToolDef = {
  name: "issues_list",
  description:
    "List issues sorted by priority (critical first) then creation time (oldest first).",
  schema: {
    status: issueStatusEnum
      .optional()
      .describe("Filter by status. Omit for all."),
    limit: z.number().optional().describe("Max results. Default 50, max 200."),
  },
};

const issues_get: ToolDef = {
  name: "issues_get",
  description:
    "Get full details for a single issue, including its description.",
  schema: {
    issueId: z
      .string()
      .describe("The issue's document ID (from issues_list or issues_create)."),
  },
};

const issues_update: ToolDef = {
  name: "issues_update",
  description:
    "Update an existing issue. Pass only the fields you want to change.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    title: z.string().optional().describe("New title."),
    description: z
      .string()
      .optional()
      .describe("New description. Supports markdown."),
    status: issueStatusEnum.optional().describe("New status."),
    priority: issuePriorityEnum.optional().describe("New priority."),
    assignee: z.string().optional().describe("Assign to an agent or person."),
  },
};

// ── Issues ────────────────────────────────────────────────────────────

const issues_close: ToolDef = {
  name: "issues_close",
  description:
    "Close an issue with a specific close type. Use this instead of issues_update for closing.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    closeType: closeTypeEnum.describe("How the issue was resolved."),
    reason: z
      .string()
      .optional()
      .describe(
        "Explanation, especially important for noop/duplicate/wontfix.",
      ),
  },
};

const issues_ready: ToolDef = {
  name: "issues_ready",
  description:
    "List unblocked open issues eligible for work. Excludes circuit-broken issues (failureCount >= maxFailures). Sorted by priority then creation time.",
  schema: {
    limit: z.number().optional().describe("Max results. Default 50, max 200."),
  },
};

const issues_defer: ToolDef = {
  name: "issues_defer",
  description:
    "Defer an issue — removes it from the ready queue. Requires a note explaining why (creates a comment automatically).",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    note: z.string().describe("Why this issue is being deferred."),
  },
};

const issues_undefer: ToolDef = {
  name: "issues_undefer",
  description:
    "Undefer an issue — returns it to the ready queue. Requires a note explaining the decision (creates a comment automatically).",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    note: z.string().describe("Why this issue is being undeferred."),
  },
};

const issues_retry: ToolDef = {
  name: "issues_retry",
  description:
    "Reset an issue's failureCount to 0, making it eligible for pickup again after circuit breaker tripped.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
  },
};

const issues_unstick: ToolDef = {
  name: "issues_unstick",
  description:
    "Reset a stuck issue back to open status. Resets failureCount and reviewIterations to 0 for a fresh attempt.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
  },
};

const issues_search: ToolDef = {
  name: "issues_search",
  description:
    "Search issues by title (full-text via search index) and description (substring match). Title matches rank first. Scoped to the current project.",
  schema: {
    query: z.string().describe("Search query text."),
    limit: z.number().optional().describe("Max results. Default 20, max 100."),
  },
};

// ── Comments ─────────────────────────────────────────────────────────

const comments_list: ToolDef = {
  name: "comments_list",
  description: "List comments for an issue, ordered by creation time.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    limit: z.number().optional().describe("Max results. Default 50, max 200."),
  },
};

const comments_create: ToolDef = {
  name: "comments_create",
  description: "Add a comment to an issue.",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
    content: z.string().describe("The comment text. Supports markdown."),
    author: commentAuthorEnum
      .optional()
      .describe("Comment author type. Defaults to 'agent'."),
  },
};

// ── Epics ─────────────────────────────────────────────────────────────

const epics_list: ToolDef = {
  name: "epics_list",
  description: "List epics with optional status filter.",
  schema: {
    status: epicStatusEnum
      .optional()
      .describe("Filter by status. Omit for all."),
    limit: z.number().optional().describe("Max results. Default 50, max 200."),
  },
};

const epics_create: ToolDef = {
  name: "epics_create",
  description: "Create a new epic in the project.",
  schema: {
    title: z.string().describe("Epic title."),
    description: z
      .string()
      .optional()
      .describe("Detailed description. Supports markdown."),
  },
};

const epics_show: ToolDef = {
  name: "epics_show",
  description: "Get full details for an epic, including its child issues.",
  schema: {
    epicId: z.string().describe("The epic's document ID."),
  },
};

const epics_update: ToolDef = {
  name: "epics_update",
  description:
    "Update an existing epic. Pass only the fields you want to change.",
  schema: {
    epicId: z.string().describe("The epic's document ID."),
    title: z.string().optional().describe("New title."),
    description: z
      .string()
      .optional()
      .describe("New description. Supports markdown."),
  },
};

const epics_close: ToolDef = {
  name: "epics_close",
  description:
    "Close an epic. No validation — can close with open child issues.",
  schema: {
    epicId: z.string().describe("The epic's document ID."),
    reason: z.string().optional().describe("Why this epic is being closed."),
  },
};

// ── Labels (stubs) ────────────────────────────────────────────────────

const labels_list: ToolDef = {
  name: "labels_list",
  description: "List all labels for the project.",
  schema: {},
};

const labels_create: ToolDef = {
  name: "labels_create",
  description: "Create a new label.",
  schema: {
    name: z.string().describe("Label name (e.g., 'bug', 'feature')."),
    color: z.string().describe("Hex color for UI badge (e.g., '#ff0000')."),
  },
};

const labels_update: ToolDef = {
  name: "labels_update",
  description: "Update an existing label.",
  schema: {
    labelId: z.string().describe("The label's document ID."),
    name: z.string().optional().describe("New name."),
    color: z.string().optional().describe("New hex color."),
  },
};

const labels_delete: ToolDef = {
  name: "labels_delete",
  description: "Delete a label.",
  schema: {
    labelId: z.string().describe("The label's document ID."),
  },
};

// ── Dependencies (stubs) ──────────────────────────────────────────────

const deps_add: ToolDef = {
  name: "deps_add",
  description:
    "Add a dependency between issues. Validates no cycle would be created.",
  schema: {
    blockerId: z.string().describe("The issue that must complete first."),
    blockedId: z.string().describe("The issue that is blocked."),
  },
};

const deps_remove: ToolDef = {
  name: "deps_remove",
  description: "Remove a dependency between issues.",
  schema: {
    blockerId: z.string().describe("The blocker issue's document ID."),
    blockedId: z.string().describe("The blocked issue's document ID."),
  },
};

const deps_listForIssue: ToolDef = {
  name: "deps_listForIssue",
  description:
    "List all dependencies for an issue (both blockers and blocked-by).",
  schema: {
    issueId: z.string().describe("The issue's document ID."),
  },
};

// ── Batch ─────────────────────────────────────────────────────────────

const issues_bulk_create: ToolDef = {
  name: "issues_bulk_create",
  description:
    "Create multiple issues in one call. Useful for retro findings or batch imports.",
  schema: {
    issues: jsonArray(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        priority: issuePriorityEnum.optional(),
      }),
    ).describe("Array of issues to create."),
  },
};

const issues_bulk_update: ToolDef = {
  name: "issues_bulk_update",
  description:
    "Update multiple issues in one call. Useful for batch priority changes.",
  schema: {
    updates: jsonArray(
      z.object({
        issueId: z.string(),
        status: issueStatusEnum.optional(),
        priority: issuePriorityEnum.optional(),
      }),
    ).describe("Array of issue updates. Each must include issueId."),
  },
};

// ── Sessions (implemented + stubs) ────────────────────────────────────

const sessions_list: ToolDef = {
  name: "sessions_list",
  description:
    "List orchestrator sessions, optionally filtered by status. Sorted by most recent first.",
  schema: {
    status: sessionStatusEnum
      .optional()
      .describe("Filter by session status. Omit for all."),
  },
};

const sessions_show: ToolDef = {
  name: "sessions_show",
  description:
    "Get session detail with transcript. Shows last 100 lines of output — live from buffer for running sessions, from history for completed sessions.",
  schema: {
    sessionId: z.string().describe("The session's document ID."),
  },
};

// ── Orchestrator (implemented + stubs) ────────────────────────────────

const orchestrator_run: ToolDef = {
  name: "orchestrator_run",
  description:
    "Trigger the orchestrator to work on an issue. Claims the issue, spawns an agent, and returns immediately. The agent runs in the background — use orchestrator_status to monitor.",
  schema: {
    issueId: z.string().describe("The issue document ID to work on."),
  },
};

const orchestrator_kill: ToolDef = {
  name: "orchestrator_kill",
  description:
    "Kill the currently running agent session. The issue stays in_progress for manual hand-off.",
  schema: {},
};

const orchestrator_status: ToolDef = {
  name: "orchestrator_status",
  description:
    "Get the current orchestrator state (idle or busy) and active session info if running.",
  schema: {},
};

const orchestrator_enable: ToolDef = {
  name: "orchestrator_enable",
  description:
    "Start the scheduler — begins picking up ready issues automatically.",
  schema: {},
};

const orchestrator_stop: ToolDef = {
  name: "orchestrator_stop",
  description:
    "Stop queuing new work. Current session (if any) continues to completion.",
  schema: {},
};

// ── All tools ─────────────────────────────────────────────────────────

export const allTools: ToolDef[] = [
  // Issues
  issues_create,
  issues_list,
  issues_get,
  issues_update,
  issues_close,
  issues_ready,
  issues_defer,
  issues_undefer,
  issues_retry,
  issues_unstick,
  issues_search,

  // Comments
  comments_list,
  comments_create,

  // Epics
  epics_list,
  epics_create,
  epics_show,
  epics_update,
  epics_close,

  // Labels
  labels_list,
  labels_create,
  labels_update,
  labels_delete,

  // Dependencies
  deps_add,
  deps_remove,
  deps_listForIssue,

  // Batch
  issues_bulk_create,
  issues_bulk_update,

  // Sessions
  sessions_list,
  sessions_show,

  // Orchestrator
  orchestrator_run,
  orchestrator_kill,
  orchestrator_status,
  orchestrator_enable,
  orchestrator_stop,
];

/** Lookup map for O(1) access by name. */
export const toolsByName = new Map(allTools.map((t) => [t.name, t]));
