// Tool schema definitions — single source of truth for all MCP tool names, descriptions, and input schemas.
import { z } from "zod";
import {
  CloseType,
  type CloseTypeValue,
  CommentAuthor,
  type CommentAuthorValue,
  EpicStatus,
  type EpicStatusValue,
  IssuePriority,
  type IssuePriorityValue,
  IssueStatus,
  type IssueStatusValue,
  SessionStatus,
  type SessionStatusValue,
} from "$convex/schema";

export type {
  CloseTypeValue,
  CommentAuthorValue,
  EpicStatusValue,
  IssuePriorityValue,
  IssueStatusValue,
  SessionStatusValue,
} from "$convex/schema";

// ── Derived Zod enums (single source of truth from Convex schema) ────
// These use `z.enum()` with explicit literal tuples derived from the Convex
// `as const` objects. The `as [V, ...V[]]` cast satisfies z.enum's requirement
// for a non-empty tuple while preserving the narrow literal union type V.
// Value types are imported from convex/schema.ts (re-exported above).
const issueStatusEnum = z.enum(
  Object.values(IssueStatus) as [IssueStatusValue, ...IssueStatusValue[]],
);

const issuePriorityEnum = z.enum(
  Object.values(IssuePriority) as [IssuePriorityValue, ...IssuePriorityValue[]],
);

const epicStatusEnum = z.enum(
  Object.values(EpicStatus) as [EpicStatusValue, ...EpicStatusValue[]],
);

const commentAuthorEnum = z.enum(
  Object.values(CommentAuthor) as [CommentAuthorValue, ...CommentAuthorValue[]],
);

const closeTypeEnum = z.enum(
  Object.values(CloseType) as [CloseTypeValue, ...CloseTypeValue[]],
);

const sessionStatusEnum = z.enum(
  Object.values(SessionStatus) as [SessionStatusValue, ...SessionStatusValue[]],
);

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

// ── Zod object schemas (single source of truth for both ToolDef and handler types) ──

export const IssuesCreateSchema = z.object({
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
});

export const IssuesListSchema = z.object({
  status: issueStatusEnum
    .optional()
    .describe("Filter by status. Omit for all."),
  limit: z.number().optional().describe("Max results. Default 50, max 200."),
});

export const IssuesGetSchema = z.object({
  issueId: z
    .string()
    .describe(
      "The issue's document ID or short ID (e.g. LUCKYDO-42 or FLUX-42).",
    ),
});

export const IssuesUpdateSchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
  title: z.string().optional().describe("New title."),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("New description (supports markdown). Pass null to clear."),
  status: issueStatusEnum.optional().describe("New status."),
  priority: issuePriorityEnum.optional().describe("New priority."),
  assignee: z
    .string()
    .nullable()
    .optional()
    .describe("Assign to an agent or person. Pass null to clear."),
});

export const IssuesCloseSchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
  closeType: closeTypeEnum.describe("How the issue was resolved."),
  reason: z
    .string()
    .optional()
    .describe("Explanation, especially important for noop/duplicate/wontfix."),
});

export const IssuesReadySchema = z.object({
  limit: z.number().optional().describe("Max results. Default 50, max 200."),
});

export const IssuesDeferSchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
  note: z.string().describe("Why this issue is being deferred."),
});

export const IssuesUndeferSchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
  note: z.string().describe("Why this issue is being undeferred."),
});

export const IssuesRetrySchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
});

export const IssuesSearchSchema = z.object({
  query: z.string().describe("Search query text."),
  limit: z.number().optional().describe("Max results. Default 20, max 100."),
});

export const IssuesListBySessionSchema = z.object({
  sessionId: z
    .string()
    .describe(
      "The session's document ID (from sessions_list or sessions_show).",
    ),
});

export const CommentsListSchema = z.object({
  issueId: z
    .string()
    .describe("The issue's document ID or short ID (e.g. FLUX-42)."),
  limit: z.number().optional().describe("Max results. Default 50, max 200."),
});

export const CommentsCreateSchema = z.object({
  issueId: z
    .string()
    .describe("The issue's document ID or short ID (e.g. FLUX-42)."),
  content: z.string().describe("The comment text. Supports markdown."),
  author: commentAuthorEnum
    .optional()
    .describe("Comment author type. Defaults to 'agent'."),
});

export const EpicsListSchema = z.object({
  status: epicStatusEnum.optional().describe("Filter by status. Omit for all."),
  limit: z.number().optional().describe("Max results. Default 50, max 200."),
});

export const EpicsCreateSchema = z.object({
  title: z.string().describe("Epic title."),
  description: z
    .string()
    .optional()
    .describe("Detailed description. Supports markdown."),
});

export const EpicsShowSchema = z.object({
  epicId: z.string().describe("The epic's document ID."),
});

export const EpicsUpdateSchema = z.object({
  epicId: z.string().describe("The epic's document ID."),
  title: z.string().optional().describe("New title."),
  description: z
    .string()
    .optional()
    .describe("New description. Supports markdown."),
});

export const EpicsCloseSchema = z.object({
  epicId: z.string().describe("The epic's document ID."),
  reason: z.string().optional().describe("Why this epic is being closed."),
});

export const LabelsListSchema = z.object({});

export const LabelsCreateSchema = z.object({
  name: z.string().describe("Label name (e.g., 'bug', 'feature')."),
  color: z.string().describe("Hex color for UI badge (e.g., '#ff0000')."),
});

export const LabelsUpdateSchema = z.object({
  labelId: z.string().describe("The label's document ID."),
  name: z.string().optional().describe("New name."),
  color: z.string().optional().describe("New hex color."),
});

export const LabelsDeleteSchema = z.object({
  labelId: z.string().describe("The label's document ID."),
});

export const DepsAddSchema = z.object({
  blockerId: z.string().describe("The issue that must complete first."),
  blockedId: z.string().describe("The issue that is blocked."),
});

export const DepsRemoveSchema = z.object({
  blockerId: z.string().describe("The blocker issue's document ID."),
  blockedId: z.string().describe("The blocked issue's document ID."),
});

export const DepsListForIssueSchema = z.object({
  issueId: z.string().describe("The issue's document ID."),
});

export const IssuesBulkCreateSchema = z.object({
  issues: jsonArray(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: issuePriorityEnum.optional(),
    }),
  ).describe("Array of issues to create."),
});

export const IssuesBulkUpdateSchema = z.object({
  updates: jsonArray(
    z.object({
      issueId: z.string(),
      status: issueStatusEnum.optional(),
      priority: issuePriorityEnum.optional(),
    }),
  ).describe("Array of issue updates. Each must include issueId."),
});

export const SessionsListSchema = z.object({
  status: sessionStatusEnum
    .optional()
    .describe("Filter by session status. Omit for all."),
  limit: z
    .number()
    .int()
    .positive()
    .default(50)
    .describe("Maximum number of sessions to return. Default 50."),
});

export const SessionsShowSchema = z.object({
  sessionId: z.string().describe("The session's document ID."),
});

export const OrchestratorRunSchema = z.object({
  issueId: z.string().describe("The issue document ID to work on."),
});

export const OrchestratorKillSchema = z.object({});

export const OrchestratorStatusSchema = z.object({});

export const PromptsSetWorkSchema = z.object({
  prompt: z
    .string()
    .describe(
      "Custom prompt text for the work phase. Pass empty string to clear.",
    ),
});

export const PromptsSetRetroSchema = z.object({
  prompt: z
    .string()
    .describe(
      "Custom prompt text for the retro phase. Pass empty string to clear.",
    ),
});

export const PromptsSetReviewSchema = z.object({
  prompt: z
    .string()
    .describe(
      "Custom prompt text for the review phase. Pass empty string to clear.",
    ),
});

export const PromptsGetSchema = z.object({});

// ── ToolDef instances (derive .schema from Zod object .shape) ────────

const issues_create: ToolDef = {
  name: "issues_create",
  description:
    "Create a new issue in the project. Returns the created issue with its assigned shortId.",
  schema: IssuesCreateSchema.shape,
};

const issues_list: ToolDef = {
  name: "issues_list",
  description:
    "List issues sorted by priority (critical first) then creation time (oldest first).",
  schema: IssuesListSchema.shape,
};

const issues_get: ToolDef = {
  name: "issues_get",
  description:
    "Get full details for a single issue, including its description.",
  schema: IssuesGetSchema.shape,
};

const issues_update: ToolDef = {
  name: "issues_update",
  description:
    "Update an existing issue. Pass only the fields you want to change. Pass null to clear an optional field.",
  schema: IssuesUpdateSchema.shape,
};

const issues_close: ToolDef = {
  name: "issues_close",
  description:
    "Close an issue with a specific close type. Use this instead of issues_update for closing.",
  schema: IssuesCloseSchema.shape,
};

const issues_ready: ToolDef = {
  name: "issues_ready",
  description:
    "List unblocked open issues eligible for work. Excludes circuit-broken issues (failureCount >= maxFailures). Sorted by priority then creation time.",
  schema: IssuesReadySchema.shape,
};

const issues_defer: ToolDef = {
  name: "issues_defer",
  description:
    "Defer an issue — removes it from the ready queue. Requires a note explaining why (creates a comment automatically).",
  schema: IssuesDeferSchema.shape,
};

const issues_undefer: ToolDef = {
  name: "issues_undefer",
  description:
    "Undefer an issue — returns it to the ready queue. Requires a note explaining the decision (creates a comment automatically).",
  schema: IssuesUndeferSchema.shape,
};

const issues_retry: ToolDef = {
  name: "issues_retry",
  description:
    "Reset a stuck issue to open status. Resets failureCount and reviewIterations to 0 for a fresh attempt.",
  schema: IssuesRetrySchema.shape,
};

const issues_search: ToolDef = {
  name: "issues_search",
  description:
    "Search issues by title (full-text) or shortId (e.g. FLUX-42). ShortId matches rank first. Scoped to the current project.",
  schema: IssuesSearchSchema.shape,
};

const issues_list_by_session: ToolDef = {
  name: "issues_list_by_session",
  description:
    "List all issues created during a specific session. Useful for review agents to see what follow-up issues were already created in previous review iterations.",
  schema: IssuesListBySessionSchema.shape,
};

const comments_list: ToolDef = {
  name: "comments_list",
  description:
    "List comments for an issue, ordered by creation time. Accepts a document ID or short ID.",
  schema: CommentsListSchema.shape,
};

const comments_create: ToolDef = {
  name: "comments_create",
  description: "Add a comment to an issue. Accepts a document ID or short ID.",
  schema: CommentsCreateSchema.shape,
};

const epics_list: ToolDef = {
  name: "epics_list",
  description: "List epics with optional status filter.",
  schema: EpicsListSchema.shape,
};

const epics_create: ToolDef = {
  name: "epics_create",
  description: "Create a new epic in the project.",
  schema: EpicsCreateSchema.shape,
};

const epics_show: ToolDef = {
  name: "epics_show",
  description: "Get full details for an epic, including its child issues.",
  schema: EpicsShowSchema.shape,
};

const epics_update: ToolDef = {
  name: "epics_update",
  description:
    "Update an existing epic. Pass only the fields you want to change.",
  schema: EpicsUpdateSchema.shape,
};

const epics_close: ToolDef = {
  name: "epics_close",
  description:
    "Close an epic. No validation — can close with open child issues.",
  schema: EpicsCloseSchema.shape,
};

const labels_list: ToolDef = {
  name: "labels_list",
  description: "List all labels for the project.",
  schema: LabelsListSchema.shape,
};

const labels_create: ToolDef = {
  name: "labels_create",
  description: "Create a new label.",
  schema: LabelsCreateSchema.shape,
};

const labels_update: ToolDef = {
  name: "labels_update",
  description: "Update an existing label.",
  schema: LabelsUpdateSchema.shape,
};

const labels_delete: ToolDef = {
  name: "labels_delete",
  description: "Delete a label.",
  schema: LabelsDeleteSchema.shape,
};

const deps_add: ToolDef = {
  name: "deps_add",
  description:
    "Add a dependency between issues. Validates no cycle would be created.",
  schema: DepsAddSchema.shape,
};

const deps_remove: ToolDef = {
  name: "deps_remove",
  description: "Remove a dependency between issues.",
  schema: DepsRemoveSchema.shape,
};

const deps_listForIssue: ToolDef = {
  name: "deps_listForIssue",
  description:
    "List all dependencies for an issue (both blockers and blocked-by).",
  schema: DepsListForIssueSchema.shape,
};

const issues_bulk_create: ToolDef = {
  name: "issues_bulk_create",
  description:
    "Create multiple issues in one call. Useful for retro findings or batch imports.",
  schema: IssuesBulkCreateSchema.shape,
};

const issues_bulk_update: ToolDef = {
  name: "issues_bulk_update",
  description:
    "Update multiple issues in one call. Useful for batch priority changes.",
  schema: IssuesBulkUpdateSchema.shape,
};

const sessions_list: ToolDef = {
  name: "sessions_list",
  description:
    "List orchestrator sessions, optionally filtered by status. Sorted by most recent first.",
  schema: SessionsListSchema.shape,
};

const sessions_show: ToolDef = {
  name: "sessions_show",
  description:
    "Get session detail with transcript. Shows last 100 lines of output — live from buffer for running sessions, from history for completed sessions.",
  schema: SessionsShowSchema.shape,
};

const orchestrator_run: ToolDef = {
  name: "orchestrator_run",
  description:
    "Trigger the orchestrator to work on an issue. Claims the issue, spawns an agent, and returns immediately. The agent runs in the background — use orchestrator_status to monitor.",
  schema: OrchestratorRunSchema.shape,
};

const orchestrator_kill: ToolDef = {
  name: "orchestrator_kill",
  description:
    "Kill the currently running agent session. The issue stays in_progress for manual hand-off.",
  schema: OrchestratorKillSchema.shape,
};

const orchestrator_status: ToolDef = {
  name: "orchestrator_status",
  description:
    "Get the current orchestrator state (idle or busy) and active session info if running.",
  schema: OrchestratorStatusSchema.shape,
};

const prompts_set_work: ToolDef = {
  name: "prompts_set_work",
  description:
    "Set or clear the custom work phase prompt for the active project. The work phase prompt is appended to the agent's system message during issue work sessions.",
  schema: PromptsSetWorkSchema.shape,
};

const prompts_set_retro: ToolDef = {
  name: "prompts_set_retro",
  description:
    "Set or clear the custom retro phase prompt for the active project. The retro phase prompt is appended to the agent's system message during retrospective sessions.",
  schema: PromptsSetRetroSchema.shape,
};

const prompts_set_review: ToolDef = {
  name: "prompts_set_review",
  description:
    "Set or clear the custom review phase prompt for the active project. The review phase prompt is appended to the agent's system message during review sessions.",
  schema: PromptsSetReviewSchema.shape,
};

const prompts_get: ToolDef = {
  name: "prompts_get",
  description:
    "Get all custom prompts (work, retro, review) for the active project. Returns null for any prompt that has not been set.",
  schema: PromptsGetSchema.shape,
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
  issues_search,
  issues_list_by_session,

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

  // Prompts
  prompts_set_work,
  prompts_set_retro,
  prompts_set_review,
  prompts_get,
];

/** Lookup map for O(1) access by name. */
export const toolsByName = new Map(allTools.map((t) => [t.name, t]));
