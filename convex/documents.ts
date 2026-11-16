import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const save = internalMutation({
  args: {
    ownerId: v.id("users"),
    name: v.string(),
    text: v.string(),
    tokens: v.number(),
  },
  returns: v.id("documents"),
  handler: (ctx, args) => ctx.db.insert("documents", args),
});

// Documents attached in a composer but never sent: removed a day later.
export const sweepUnsent = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("documents")
      .withIndex("by_threadId", (q) =>
        q.eq("threadId", undefined).lt("_creationTime", Date.now() - 24 * 60 * 60 * 1000),
      )
      .take(100);
    for (const d of stale) await ctx.db.delete("documents", d._id);
    return null;
  },
});
