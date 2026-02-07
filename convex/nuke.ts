import type { TableNames } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export const all = internalMutation({
  handler: async (ctx) => {
    const tables: TableNames[] = [
      "sessionEvents",
      "sessions",
      "comments",
      "dependencies",
      "issues",
      "epics",
      "labels",
      "llmCosts",
      "orchestratorConfig",
      "projects",
    ];

    let totalDeleted = 0;

    for (const tableName of tables) {
      const docs = await ctx.db.query(tableName).collect();
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
        totalDeleted++;
      }
    }

    return { deletedTables: tables.length, totalDeleted };
  },
});
