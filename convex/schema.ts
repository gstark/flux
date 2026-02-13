import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const IssueStatus = {
  Open: "open",
  InProgress: "in_progress",
  Closed: "closed",
  Deferred: "deferred",
  Stuck: "stuck",
} as const;

export const IssuePriority = {
  Critical: "critical",
  High: "high",
  Medium: "medium",
  Low: "low",
} as const;

export const SessionStatus = {
  Running: "running",
  Completed: "completed",
  Failed: "failed",
} as const;

export const sessionStatusValidator = v.union(
  v.literal(SessionStatus.Running),
  v.literal(SessionStatus.Completed),
  v.literal(SessionStatus.Failed),
);

export const SessionType = {
  Work: "work",
  Review: "review",
} as const;

export const sessionTypeValidator = v.union(
  v.literal(SessionType.Work),
  v.literal(SessionType.Review),
);

export const SessionPhase = {
  Work: "work",
  Retro: "retro",
  Review: "review",
} as const;

export type SessionPhaseValue =
  (typeof SessionPhase)[keyof typeof SessionPhase];

export const sessionPhaseValidator = v.union(
  v.literal(SessionPhase.Work),
  v.literal(SessionPhase.Retro),
  v.literal(SessionPhase.Review),
);

export const SessionEventDirection = {
  Input: "input",
  Output: "output",
} as const;

export const sessionEventDirectionValidator = v.union(
  v.literal(SessionEventDirection.Input),
  v.literal(SessionEventDirection.Output),
);

export const issueStatusValidator = v.union(
  v.literal(IssueStatus.Open),
  v.literal(IssueStatus.InProgress),
  v.literal(IssueStatus.Closed),
  v.literal(IssueStatus.Deferred),
  v.literal(IssueStatus.Stuck),
);

export const issuePriorityValidator = v.union(
  v.literal(IssuePriority.Critical),
  v.literal(IssuePriority.High),
  v.literal(IssuePriority.Medium),
  v.literal(IssuePriority.Low),
);

export const EpicStatus = {
  Open: "open",
  Closed: "closed",
} as const;

export const epicStatusValidator = v.union(
  v.literal(EpicStatus.Open),
  v.literal(EpicStatus.Closed),
);

export const CommentAuthor = {
  User: "user",
  Agent: "agent",
  Flux: "flux",
} as const;

export const commentAuthorValidator = v.union(
  v.literal(CommentAuthor.User),
  v.literal(CommentAuthor.Agent),
  v.literal(CommentAuthor.Flux),
);

export const CounterEntity = {
  Issues: "issues",
  Sessions: "sessions",
} as const;

export const counterEntityValidator = v.union(
  v.literal(CounterEntity.Issues),
  v.literal(CounterEntity.Sessions),
);

export type CounterEntityValue =
  (typeof CounterEntity)[keyof typeof CounterEntity];

export const CloseType = {
  Completed: "completed",
  Noop: "noop",
  Duplicate: "duplicate",
  Wontfix: "wontfix",
} as const;

export const closeTypeValidator = v.union(
  v.literal(CloseType.Completed),
  v.literal(CloseType.Noop),
  v.literal(CloseType.Duplicate),
  v.literal(CloseType.Wontfix),
);

export const Disposition = {
  Done: "done",
  Noop: "noop",
  Fault: "fault",
} as const;

export const dispositionValidator = v.union(
  v.literal(Disposition.Done),
  v.literal(Disposition.Noop),
  v.literal(Disposition.Fault),
);

// ── Derived value types (single source of truth) ─────────────────────
// SessionPhaseValue is defined inline above (near SessionPhase).
export type IssueStatusValue = (typeof IssueStatus)[keyof typeof IssueStatus];
export type IssuePriorityValue =
  (typeof IssuePriority)[keyof typeof IssuePriority];
export type SessionStatusValue =
  (typeof SessionStatus)[keyof typeof SessionStatus];
export type SessionTypeValue = (typeof SessionType)[keyof typeof SessionType];
export type SessionEventDirectionValue =
  (typeof SessionEventDirection)[keyof typeof SessionEventDirection];
export type CloseTypeValue = (typeof CloseType)[keyof typeof CloseType];
export type EpicStatusValue = (typeof EpicStatus)[keyof typeof EpicStatus];
export type CommentAuthorValue =
  (typeof CommentAuthor)[keyof typeof CommentAuthor];
export type DispositionValue = (typeof Disposition)[keyof typeof Disposition];

// ── Priority ordering (single source of truth) ───────────────────────
export const PRIORITY_ORDER: Record<IssuePriorityValue, number> = {
  [IssuePriority.Critical]: 0,
  [IssuePriority.High]: 1,
  [IssuePriority.Medium]: 2,
  [IssuePriority.Low]: 3,
};

/** Convert a priority string to its numeric sort order. */
export function toPriorityOrder(priority: IssuePriorityValue): number {
  const order = PRIORITY_ORDER[priority];
  if (order === undefined)
    throw new Error(`Unknown priority: ${String(priority)}`);
  return order;
}

export default defineSchema({
  projects: defineTable({
    slug: v.string(),
    name: v.string(),
    issueCounter: v.number(),
    path: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  }).index("by_slug", ["slug"]),

  issues: defineTable({
    projectId: v.id("projects"),
    shortId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    status: issueStatusValidator,
    priority: issuePriorityValidator,
    priorityOrder: v.number(),
    assignee: v.optional(v.string()),
    failureCount: v.number(),
    closedAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    sourceIssueId: v.optional(v.id("issues")),
    reviewIterations: v.optional(v.number()),
    closeType: v.optional(closeTypeValidator),
    closeReason: v.optional(v.string()),
    deferNote: v.optional(v.string()),
    epicId: v.optional(v.id("epics")),
    labelIds: v.optional(v.array(v.id("labels"))),
    deletedAt: v.optional(v.number()),
  })
    .index("by_project_deletedAt_status", ["projectId", "deletedAt", "status"])
    .index("by_project_priority", ["projectId", "deletedAt", "priorityOrder"])
    .index("by_project_status_priority", [
      "projectId",
      "deletedAt",
      "status",
      "priorityOrder",
    ])
    .index("by_epic", ["epicId"])
    .index("by_project_shortId", ["projectId", "shortId"])
    .index("by_source_issue", ["sourceIssueId", "deletedAt"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["projectId"],
    }),

  comments: defineTable({
    issueId: v.id("issues"),
    content: v.string(),
    author: commentAuthorValidator,
    createdAt: v.number(),
  }).index("by_issue", ["issueId"]),

  labels: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_name", ["projectId", "name"]),

  epics: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    status: epicStatusValidator,
    closedAt: v.optional(v.number()),
    closeReason: v.optional(v.string()),
  })
    .index("by_project", ["projectId"])
    .index("by_project_status", ["projectId", "status"]),

  llmCosts: defineTable({
    model: v.string(),
    inputTokenCost: v.number(),
    outputTokenCost: v.number(),
  }).index("by_model", ["model"]),

  sessions: defineTable({
    projectId: v.id("projects"),
    issueId: v.id("issues"),
    type: sessionTypeValidator,
    agent: v.string(),
    status: sessionStatusValidator,
    phase: v.optional(sessionPhaseValidator),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    pid: v.optional(v.number()),
    lastHeartbeat: v.optional(v.number()),
    disposition: v.optional(dispositionValidator),
    note: v.optional(v.string()),
    agentSessionId: v.optional(v.string()),
    startHead: v.optional(v.string()),
    endHead: v.optional(v.string()),
    turns: v.optional(v.number()),
    tokens: v.optional(v.number()),
    cost: v.optional(v.number()),
    toolCalls: v.optional(v.number()),
    model: v.optional(v.string()),
  })
    .index("by_project_startedAt", ["projectId", "startedAt"])
    .index("by_project_status_startedAt", ["projectId", "status", "startedAt"])
    .index("by_issue", ["issueId"]),

  sessionEvents: defineTable({
    sessionId: v.id("sessions"),
    sequence: v.number(),
    direction: sessionEventDirectionValidator,
    content: v.string(),
    timestamp: v.number(),
  }).index("by_session_sequence", ["sessionId", "sequence"]),

  orchestratorConfig: defineTable({
    projectId: v.id("projects"),
    agent: v.string(),
    focusEpicId: v.optional(v.id("epics")),
    sessionTimeoutMs: v.number(),
    maxFailures: v.number(),
    maxReviewIterations: v.number(),
  }).index("by_project", ["projectId"]),

  dependencies: defineTable({
    blockerId: v.id("issues"),
    blockedId: v.id("issues"),
  })
    .index("by_blocker_blocked", ["blockerId", "blockedId"])
    .index("by_blocked", ["blockedId"]),

  statusCounts: defineTable({
    projectId: v.id("projects"),
    entity: counterEntityValidator,
    status: v.string(),
    count: v.number(),
  }).index("by_project_entity_status", ["projectId", "entity", "status"]),
});
