import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { USAGE_FIELDS, type Usage } from "./usage";

// Upserts the three daily rollups for one metered call. Call it in the same mutation
// that writes the usage onto the message, so totals never drift from their messages.
export async function recordDailyUsage(
  ctx: MutationCtx,
  call: { ownerId: Id<"users">; at: number; model: string; providerId: string; threadId: string; usage: Usage; costMicroUsd: number | null },
) {
  const day = new Date(call.at).toISOString().slice(0, 10);
  const keys = { model: call.model, provider: call.providerId, thread: call.threadId } as const;
  for (const dimension of ["model", "provider", "thread"] as const) {
    const key = keys[dimension];
    const row = await ctx.db
      .query("dailyUsage")
      .withIndex("by_owner_day_dimension_key", (q) =>
        q.eq("ownerId", call.ownerId).eq("day", day).eq("dimension", dimension).eq("key", key),
      )
      .unique();
    const sums = Object.fromEntries(USAGE_FIELDS.map((f) => [f, (row?.[f] ?? 0) + call.usage[f]])) as Usage;
    const totals = {
      ...sums,
      calls: (row?.calls ?? 0) + 1,
      unpricedCalls: (row?.unpricedCalls ?? 0) + (call.costMicroUsd === null ? 1 : 0),
      costMicroUsd: (row?.costMicroUsd ?? 0) + (call.costMicroUsd ?? 0),
    };
    if (row) await ctx.db.patch("dailyUsage", row._id, totals);
    else await ctx.db.insert("dailyUsage", { ownerId: call.ownerId, day, dimension, key, ...totals });
  }
}
