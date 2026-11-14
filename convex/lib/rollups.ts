import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { USAGE_FIELDS, type Usage } from "./usage";

// YYYY-MM-DD for `at` in `timeZone` (UTC when unset). en-CA formats dates as YYYY-MM-DD.
export function dayIn(at: number, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

// Upserts the daily rollups for one metered call (three, or four for a keepalive). Call it in the same mutation
// that writes the usage onto the message, so totals never drift from their messages.
export async function recordDailyUsage(
  ctx: MutationCtx,
  call: {
    ownerId: Id<"users">;
    at: number;
    timeZone: string | undefined;
    model: string;
    providerId: string;
    threadId: string;
    usage: Usage;
    costMicroUsd: number | null;
    savedMicroUsd: number;
    upkeep: boolean; // a keepalive: also rolled up under "upkeep", keyed by thread
  },
) {
  const day = dayIn(call.at, call.timeZone);
  const keys = { model: call.model, provider: call.providerId, thread: call.threadId, upkeep: call.threadId } as const;
  const dimensions = call.upkeep ? (["model", "provider", "thread", "upkeep"] as const) : (["model", "provider", "thread"] as const);
  for (const dimension of dimensions) {
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
      savedMicroUsd: (row?.savedMicroUsd ?? 0) + call.savedMicroUsd,
    };
    if (row) await ctx.db.patch("dailyUsage", row._id, totals);
    else await ctx.db.insert("dailyUsage", { ownerId: call.ownerId, day, dimension, key, ...totals });
  }
}
