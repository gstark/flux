import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { AgentKind } from "./schema";

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

    // --- Orchestrator Config ---
    const existingConfig = await ctx.db
      .query("orchestratorConfig")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (!existingConfig) {
      await ctx.db.insert("orchestratorConfig", {
        projectId,
        agent: AgentKind.Pi,
        sessionTimeoutMs: 1800000, // 30 min
        maxFailures: 3,
        maxReviewIterations: 10,
      });
    }

    return {
      llmCostsAdded,
      orchestratorConfigCreated: !existingConfig,
    };
  },
});
