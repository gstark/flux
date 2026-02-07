import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const runAll = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // --- Global Seeds (LLM Costs) - upsert pattern ---
    const llmCosts = [
      { model: "claude-haiku-4.5", inputTokenCost: 1.0, outputTokenCost: 5.0 },
      {
        model: "claude-sonnet-4.5",
        inputTokenCost: 3.0,
        outputTokenCost: 15.0,
      },
      { model: "claude-opus-4.5", inputTokenCost: 5.0, outputTokenCost: 25.0 },
      { model: "claude-opus-4.6", inputTokenCost: 5.0, outputTokenCost: 25.0 },
    ];

    let llmCostsAdded = 0;
    for (const cost of llmCosts) {
      const existing = await ctx.db
        .query("llmCosts")
        .withIndex("by_model", (q) => q.eq("model", cost.model))
        .first();
      if (!existing) {
        await ctx.db.insert("llmCosts", cost);
        llmCostsAdded++;
      }
    }

    // --- Project Seeds (Labels) ---
    const labels = [
      { name: "bug", color: "#dc2626" },
      { name: "feature", color: "#2563eb" },
      { name: "chore", color: "#6b7280" },
      { name: "friction", color: "#f59e0b" },
    ];

    let labelsAdded = 0;
    for (const label of labels) {
      const existing = await ctx.db
        .query("labels")
        .withIndex("by_project_name", (q) =>
          q.eq("projectId", projectId).eq("name", label.name),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("labels", { ...label, projectId });
        labelsAdded++;
      }
    }

    // --- Orchestrator Config ---
    const existingConfig = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!existingConfig) {
      await ctx.db.insert("orchestratorConfig", {
        projectId,
        enabled: false,
        agent: "claude",
        sessionTimeoutMs: 1800000, // 30 min
        maxFailures: 3,
        maxReviewIterations: 5,
      });
    }

    return {
      llmCostsAdded,
      labelsAdded,
      orchestratorConfigCreated: !existingConfig,
    };
  },
});
