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
import { internalMutation } from "./_generated/server";
import { toPriorityOrder } from "./issues";
import { IssuePriority, type IssuePriorityValue } from "./schema";

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
          projectId: string;
          agent: string;
          sessionTimeoutMs: number;
          maxFailures: number;
          maxReviewIterations: number;
          focusEpicId?: string;
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
