import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { spentOn } from "./lib/budget";
import { USAGE_FIELDS, type Usage } from "./lib/usage";
import { requireOwner } from "./owner";

const DAYS = 30;

// The `days` days ending at `today` (YYYY-MM-DD), oldest first. Calendar math in UTC is exact
// for date strings, whatever the owner's time zone.
export function dayRange(today: string, days: number) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) =>
    new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

type Sums = {
  calls: number;
  unpricedCalls: number;
  costMicroUsd: number;
  savedMicroUsd: number;
} & Usage;
const empty = (): Sums => ({
  calls: 0,
  unpricedCalls: 0,
  costMicroUsd: 0,
  savedMicroUsd: 0,
  ...(Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0])) as Usage),
});
const add = (s: Sums, r: Doc<"dailyUsage">) => {
  s.calls += r.calls;
  s.unpricedCalls += r.unpricedCalls;
  s.costMicroUsd += r.costMicroUsd;
  s.savedMicroUsd += r.savedMicroUsd ?? 0;
  for (const f of USAGE_FIELDS) s[f] += r[f];
};
const input = (s: Usage) =>
  s.inputTokens +
  s.cacheReadTokens +
  s.cacheWriteTokens5m +
  s.cacheWriteTokens1h;

// Hit rate without keepalive reads, which refresh the cache rather than show turns hitting it.
const hitRate = (all: Sums, upkeep: Sums) => {
  const total = input(all) - input(upkeep);
  return total > 0
    ? (all.cacheReadTokens - upkeep.cacheReadTokens) / total
    : null;
};
// What caching saved, net of keeping caches warm (keepalive reads aren't savings).
const netSaved = (all: Sums, upkeep: Sums) =>
  all.savedMicroUsd - upkeep.savedMicroUsd - upkeep.costMicroUsd;

// The usage page (spec phase 3): the last 30 days in the owner's time zone, from the daily
// rollups, so spend from deleted threads still counts. `today` comes from the client because
// queries can't read the clock.
export const summary = query({
  args: { today: v.string() },
  returns: v.object({
    days: v.array(
      v.object({
        day: v.string(),
        costMicroUsd: v.number(),
        calls: v.number(),
        unpricedCalls: v.number(),
        hitRate: v.union(v.null(), v.number()),
        upkeepMicroUsd: v.number(),
        savedMicroUsd: v.number(),
      }),
    ),
    models: v.array(
      v.object({
        model: v.string(),
        costMicroUsd: v.number(),
        calls: v.number(),
        unpricedCalls: v.number(),
      }),
    ),
    savedMicroUsd7: v.number(),
    savedMicroUsd30: v.number(),
    hitRate7: v.union(v.null(), v.number()),
    hitRate30: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, { today }) => {
    const ownerId = await requireOwner(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(Date.parse(today)))
      throw new ConvexError("Invalid day");
    const range = dayRange(today, DAYS);
    // ponytail: one read of every rollup row in the range; split by dimension if it ever nears the cap.
    const rows = await ctx.db
      .query("dailyUsage")
      .withIndex("by_owner_day_dimension_key", (q) =>
        q.eq("ownerId", ownerId).gte("day", range[0]).lte("day", today),
      )
      .take(8000);

    // Every call is rolled up once per provider, so provider rows are the day's totals.
    const byDay = new Map(
      range.map((d) => [d, { all: empty(), upkeep: empty() }]),
    );
    const models = new Map<string, Sums>();
    for (const r of rows) {
      const day = byDay.get(r.day);
      if (!day) continue;
      if (r.dimension === "provider") add(day.all, r);
      else if (r.dimension === "upkeep") add(day.upkeep, r);
      else if (r.dimension === "model") {
        const m = models.get(r.key) ?? empty();
        add(m, r);
        models.set(r.key, m);
      }
    }
    const days = range.map((day) => {
      const { all, upkeep } = byDay.get(day)!;
      return {
        day,
        costMicroUsd: all.costMicroUsd,
        calls: all.calls,
        unpricedCalls: all.unpricedCalls,
        hitRate: hitRate(all, upkeep),
        upkeepMicroUsd: upkeep.costMicroUsd,
        savedMicroUsd: netSaved(all, upkeep),
      };
    });
    const total = (last: number) => {
      const all = empty();
      const upkeep = empty();
      for (const d of range.slice(-last)) {
        const sums = byDay.get(d)!;
        for (const [into, from] of [
          [all, sums.all],
          [upkeep, sums.upkeep],
        ] as const) {
          into.calls += from.calls;
          into.unpricedCalls += from.unpricedCalls;
          into.costMicroUsd += from.costMicroUsd;
          into.savedMicroUsd += from.savedMicroUsd;
          for (const f of USAGE_FIELDS) into[f] += from[f];
        }
      }
      return { all, upkeep };
    };
    const week = total(7);
    const month = total(DAYS);
    return {
      days,
      models: [...models]
        .map(([model, s]) => ({
          model,
          costMicroUsd: s.costMicroUsd,
          calls: s.calls,
          unpricedCalls: s.unpricedCalls,
        }))
        .sort((a, b) => b.costMicroUsd - a.costMicroUsd || b.calls - a.calls),
      savedMicroUsd7: netSaved(week.all, week.upkeep),
      savedMicroUsd30: netSaved(month.all, month.upkeep),
      hitRate7: hitRate(week.all, week.upkeep),
      hitRate30: hitRate(month.all, month.upkeep),
    };
  },
});

// Today's soft-budget state for the composer banner and the usage page. `today` comes from the
// client (the owner's day) because queries can't read the clock.
export const budget = query({
  args: { today: v.string() },
  returns: v.object({
    budgetMicroUsd: v.union(v.null(), v.number()),
    spentMicroUsd: v.number(),
    overridden: v.boolean(),
  }),
  handler: async (ctx, { today }) => {
    const ownerId = await requireOwner(ctx);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    return {
      budgetMicroUsd: settings?.dailyBudgetMicroUsd ?? null,
      spentMicroUsd: await spentOn(ctx, ownerId, today),
      overridden: settings?.budgetOverrideDay === today,
    };
  },
});
