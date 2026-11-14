import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { dayIn } from "./rollups";

// ponytail: sums every provider row of the day; one row per provider, so a handful of reads.
// Unpriced calls add $0: the budget can only count what has a price.
export async function spentOn(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  day: string,
) {
  const rows = await ctx.db
    .query("dailyUsage")
    .withIndex("by_owner_day_dimension_key", (q) =>
      q.eq("ownerId", ownerId).eq("day", day).eq("dimension", "provider"),
    )
    .take(100);
  return rows.reduce((sum, r) => sum + r.costMicroUsd, 0);
}

// The soft daily budget (spec phase 3), judged at `now` in the owner's time zone: reached when
// today's spend is at or over it and the owner hasn't overridden it for today.
export async function budgetReached(
  ctx: QueryCtx,
  settings: Doc<"settings"> | null,
  now: number,
) {
  if (!settings?.dailyBudgetMicroUsd) return false;
  const day = dayIn(now, settings.timeZone);
  if (settings.budgetOverrideDay === day) return false;
  return (
    (await spentOn(ctx, settings.ownerId, day)) >= settings.dailyBudgetMicroUsd
  );
}

export const BUDGET_REACHED = "Daily budget reached";

export async function assertWithinBudget(ctx: QueryCtx, ownerId: Id<"users">) {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  if (await budgetReached(ctx, settings, Date.now()))
    throw new ConvexError(BUDGET_REACHED);
}
