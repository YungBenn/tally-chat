import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordDailyUsage } from "./rollups";
import { costMicroUsd, priceFor, type Usage } from "./usage";

// Prices one provider call, adds it to the daily rollups and learns the provider's
// capabilities from what it reported. Returns the cost, or null when it has no price.
export async function meterCall(
  ctx: MutationCtx,
  call: {
    ownerId: Id<"users">;
    threadId: Id<"threads">;
    providerId: Id<"providers"> | undefined;
    model: string;
    normalized: { usage: Usage; reports?: { caching: boolean; reasoning: boolean }; reportedCostMicroUsd?: number };
  },
) {
  const { usage, reports, reportedCostMicroUsd } = call.normalized;
  const provider = call.providerId && (await ctx.db.get("providers", call.providerId));
  // Free providers (local models) cost nothing; a provider-reported cost beats the table.
  const cost = provider && provider.free ? 0 : (reportedCostMicroUsd ?? costMicroUsd(usage, priceFor(call.model)));
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", call.ownerId))
    .unique();
  await recordDailyUsage(ctx, {
    ownerId: call.ownerId,
    at: Date.now(),
    timeZone: settings?.timeZone,
    model: call.model,
    providerId: call.providerId ?? "",
    threadId: call.threadId,
    usage,
    costMicroUsd: cost,
  });
  if (provider && reports) {
    const known = provider.capabilities ?? { caching: false, reasoning: false };
    const capabilities = { caching: known.caching || reports.caching, reasoning: known.reasoning || reports.reasoning };
    if (capabilities.caching !== known.caching || capabilities.reasoning !== known.reasoning || !provider.capabilities) {
      await ctx.db.patch("providers", provider._id, { capabilities });
    }
  }
  return cost;
}
