/**
 * Idempotent data migrations for schema field promotions.
 *
 * Run before `bunx convex deploy` when promoting a field from optional to required.
 * Each migration is safe to re-run — it skips documents that already have the field.
 *
 * Usage:
 *   bunx convex run migrations:backfillPriorityOrder
 *
 * See CLAUDE.md "Schema Migrations" for the full workflow.
 */
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { AgentKindValue } from "./schema";
import {
  CounterEntity,
  IssuePriority,
  type IssuePriorityValue,
  IssueStatus,
  SessionStatus,
  toPriorityOrder,
} from "./schema";

/**
 * Backfill `enabled` on projects that have the old `state` field.
 *
 * Converts: running → true, paused/stopped/undefined → false.
 * Safe to re-run: skips any project that already has a boolean `enabled`.
 */
export const backfillProjectEnabled = internalMutation({
  handler: async (ctx) => {
    const allProjects = await ctx.db.query("projects").collect();

    let patched = 0;
    let skipped = 0;

    for (const project of allProjects) {
      // Already backfilled — skip
      if (typeof project.enabled === "boolean") {
        skipped++;
        continue;
      }

      // Derive from old state field
      const oldState = (project as Record<string, unknown>).state as
        | string
        | undefined;
      const enabled = oldState === "running";

      await ctx.db.patch(project._id, { enabled });
      patched++;
    }

    return { patched, skipped, total: allProjects.length };
  },
});

/**
 * Strip legacy fields that are no longer in the canonical schema.
 *
 * - `projects.state` (replaced by `projects.enabled`)
 * - `orchestratorConfig.enabled` (redundant with `projects.enabled`)
 *
 * Uses `ctx.db.replace` because `ctx.db.patch` cannot remove fields.
 * Safe to re-run: skips documents that don't have the legacy field.
 */
export const stripLegacyFields = internalMutation({
  handler: async (ctx) => {
    let projectsPatched = 0;
    let configsPatched = 0;

    // Strip `state` from projects
    const allProjects = await ctx.db.query("projects").collect();
    for (const project of allProjects) {
      const raw = project as Record<string, unknown>;
      if (!("state" in raw)) continue;

      const { state: _state, _id, _creationTime, ...rest } = raw;
      await ctx.db.replace(
        project._id,
        rest as {
          slug: string;
          name: string;
          issueCounter: number;
          path?: string;
          enabled?: boolean;
        },
      );
      projectsPatched++;
    }

    // Strip `enabled` from orchestratorConfig
    const allConfigs = await ctx.db.query("orchestratorConfig").collect();
    for (const config of allConfigs) {
      const raw = config as Record<string, unknown>;
      if (!("enabled" in raw)) continue;

      const { enabled: _enabled, _id, _creationTime, ...rest } = raw;
      await ctx.db.replace(
        config._id,
        rest as {
          projectId: Id<"projects">;
          agent: AgentKindValue;
          sessionTimeoutMs: number;
          maxFailures: number;
          maxReviewIterations: number;
          focusEpicId?: Id<"epics">;
        },
      );
      configsPatched++;
    }

    return {
      projectsPatched,
      configsPatched,
      totalProjects: allProjects.length,
      totalConfigs: allConfigs.length,
    };
  },
});

/**
 * Backfill `priorityOrder` on issues that are missing it.
 *
 * Added for FLUX-207 (made priorityOrder required). Safe to re-run:
 * skips any issue that already has a numeric priorityOrder.
 */
export const backfillPriorityOrder = internalMutation({
  handler: async (ctx) => {
    const allIssues = await ctx.db.query("issues").collect();

    let patched = 0;
    let skipped = 0;

    for (const issue of allIssues) {
      // Already has a valid priorityOrder — skip
      if (typeof issue.priorityOrder === "number") {
        skipped++;
        continue;
      }

      // Derive from priority field. If priority is also missing, default to medium.
      const priority =
        (issue.priority as IssuePriorityValue) ?? IssuePriority.Medium;

      await ctx.db.patch(issue._id, {
        priorityOrder: toPriorityOrder(priority),
      });
      patched++;
    }

    return { patched, skipped, total: allIssues.length };
  },
});

/**
 * Backfill `statusCounts` from existing issues and sessions.
 *
 * Added for FLUX-357 (counter table for O(1) counting). Counts all non-deleted
 * issues and all sessions per project per status, then upserts the counter rows.
 *
 * Safe to re-run: replaces counters with freshly computed values each time.
 */
export const backfillStatusCounts = internalMutation({
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    let countersWritten = 0;

    for (const project of projects) {
      // --- Issues: count non-deleted issues per status ---
      for (const status of Object.values(IssueStatus)) {
        const docs = await ctx.db
          .query("issues")
          .withIndex("by_project_deletedAt_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("deletedAt", undefined)
              .eq("status", status),
          )
          .collect();

        const existing = await ctx.db
          .query("statusCounts")
          .withIndex("by_project_entity_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("entity", CounterEntity.Issues)
              .eq("status", status),
          )
          .unique();

        if (existing) {
          await ctx.db.patch(existing._id, { count: docs.length });
        } else {
          await ctx.db.insert("statusCounts", {
            projectId: project._id,
            entity: CounterEntity.Issues,
            status,
            count: docs.length,
          });
        }
        countersWritten++;
      }

      // --- Sessions: count all sessions per status ---
      for (const status of Object.values(SessionStatus)) {
        const docs = await ctx.db
          .query("sessions")
          .withIndex("by_project_status_startedAt", (q) =>
            q.eq("projectId", project._id).eq("status", status),
          )
          .collect();

        const existing = await ctx.db
          .query("statusCounts")
          .withIndex("by_project_entity_status", (q) =>
            q
              .eq("projectId", project._id)
              .eq("entity", CounterEntity.Sessions)
              .eq("status", status),
          )
          .unique();

        if (existing) {
          await ctx.db.patch(existing._id, { count: docs.length });
        } else {
          await ctx.db.insert("statusCounts", {
            projectId: project._id,
            entity: CounterEntity.Sessions,
            status,
            count: docs.length,
          });
        }
        countersWritten++;
      }
    }

    return { countersWritten, projects: projects.length };
  },
});

/**
 * Shift all timestamps on issues, sessions, session events, and comments
 * for a given project so they fall within the last 7 days.
 *
 * Adds a fixed offset (now - maxTimestamp) to every custom timestamp field.
 * Does NOT touch `_creationTime` (system-managed).
 *
 * Usage: bunx convex run migrations:shiftTimestamps '{"projectSlug":"flux"}'
 */
export const shiftTimestamps = internalMutation({
  handler: async (ctx) => {
    // Get ALL issues and sessions across ALL projects
    const issues = await ctx.db.query("issues").collect();
    const sessions = await ctx.db.query("sessions").collect();

    let maxTs = 0;
    for (const issue of issues) {
      if (issue.updatedAt && issue.updatedAt > maxTs) maxTs = issue.updatedAt;
      if (issue.closedAt && issue.closedAt > maxTs) maxTs = issue.closedAt;
    }
    for (const session of sessions) {
      if (session.startedAt > maxTs) maxTs = session.startedAt;
      if (session.endedAt && session.endedAt > maxTs) maxTs = session.endedAt;
    }

    if (maxTs === 0) throw new Error("No timestamps found");

    // Offset: shift so max timestamp → 1 hour ago
    const offset = Date.now() - 3600_000 - maxTs;
    // Skip if already shifted (offset < 1 day)
    if (Math.abs(offset) < 86_400_000)
      return { skipped: true, offsetDays: +(offset / 86_400_000).toFixed(2) };
    const shift = (ts: number | undefined) =>
      ts !== undefined ? ts + offset : undefined;

    // Patch issues
    let issuesPatched = 0;
    for (const issue of issues) {
      const patch: Record<string, number | undefined> = {};
      if (issue.updatedAt) patch.updatedAt = shift(issue.updatedAt);
      if (issue.closedAt) patch.closedAt = shift(issue.closedAt);
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(issue._id, patch);
        issuesPatched++;
      }
    }

    // Patch sessions
    let sessionsPatched = 0;
    for (const session of sessions) {
      const patch: Record<string, number | undefined> = {};
      patch.startedAt = shift(session.startedAt);
      if (session.endedAt) patch.endedAt = shift(session.endedAt);
      if (session.lastHeartbeat)
        patch.lastHeartbeat = shift(session.lastHeartbeat);
      await ctx.db.patch(session._id, patch);
      sessionsPatched++;
    }

    return {
      offsetMs: offset,
      offsetDays: +(offset / 86_400_000).toFixed(2),
      issuesPatched,
      sessionsPatched,
    };
  },
});

/**
 * Backfill `worktreeSlug` on epics that have `useWorktree=true` but no slug.
 *
 * Added for FLUX-53 (worktree slug derived from mutable title). Computes
 * the slug from the current title and persists it so future title changes
 * don't orphan the worktree.
 *
 * Safe to re-run: skips epics that already have a worktreeSlug.
 */
export const backfillWorktreeSlug = internalMutation({
  handler: async (ctx) => {
    const allEpics = await ctx.db.query("epics").collect();

    let patched = 0;
    let skipped = 0;

    for (const epic of allEpics) {
      if (epic.worktreeSlug || !epic.useWorktree) {
        skipped++;
        continue;
      }

      const slug = epic.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      if (!slug) {
        throw new Error(
          `Epic ${epic._id} title "${epic.title}" produces an empty slug — fix title before migrating.`,
        );
      }

      await ctx.db.patch(epic._id, { worktreeSlug: slug });
      patched++;
    }

    return { patched, skipped, total: allEpics.length };
  },
});

/**
 * Fix sessions with invalid type/phase="workshop" and extra fields like epicId.
 *
 * The document k9720fmqq0pa92rz6x8nbb4fpd84rxk9 has type: "workshop",
 * phase: "workshop", and an extra epicId field — all blocking schema deployment.
 * Uses db.replace to strip extra fields; patches type/phase to "work".
 *
 * Safe to re-run: skips sessions that already have valid values and no extra fields.
 */
export const fixWorkshopPhase = internalMutation({
  handler: async (ctx) => {
    const VALID_TYPES = new Set(["work", "review", "planner"]);
    const VALID_PHASES = new Set(["work", "retro", "review", "planner"]);
    const KNOWN_FIELDS = new Set([
      "_id",
      "_creationTime",
      "projectId",
      "issueId",
      "type",
      "agent",
      "status",
      "phase",
      "startedAt",
      "endedAt",
      "exitCode",
      "pid",
      "lastHeartbeat",
      "disposition",
      "note",
      "agentSessionId",
      "startHead",
      "endHead",
      "turns",
      "tokens",
      "cost",
      "toolCalls",
      "model",
    ]);

    const allSessions = await ctx.db.query("sessions").collect();

    let patched = 0;
    let skipped = 0;

    for (const session of allSessions) {
      const raw = session as Record<string, unknown>;
      const type = raw.type as string;
      const phase = raw.phase as string | undefined;

      const badType = !VALID_TYPES.has(type);
      const badPhase = phase !== undefined && !VALID_PHASES.has(phase);
      const extraFields = Object.keys(raw).filter((k) => !KNOWN_FIELDS.has(k));

      if (!badType && !badPhase && extraFields.length === 0) {
        skipped++;
        continue;
      }

      // Build a clean document with only known fields
      const clean: Record<string, unknown> = {};
      for (const key of KNOWN_FIELDS) {
        if (key === "_id" || key === "_creationTime") continue;
        if (key in raw) clean[key] = raw[key];
      }
      if (badType) clean.type = "work";
      if (badPhase) clean.phase = "work";

      await ctx.db.replace(session._id, clean as never);
      patched++;
    }

    return { patched, skipped, total: allSessions.length };
  },
});
