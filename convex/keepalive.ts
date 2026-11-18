import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  ACTIVE_WINDOW_MS,
  cacheExpiresAt,
  cacheState,
  cacheTtlValidator,
} from "./lib/cacheStatus";
import { activeBranch, effortFor, isCheaperReply } from "./chat";
import { budgetReached } from "./lib/budget";
import { effortValidator } from "./lib/effort";
import { imageValidator } from "./lib/images";
import { assembleHistory } from "./lib/context";
import { meterCall } from "./lib/metering";
import { usageValidator, type Usage } from "./lib/usage";
import { systemPrompt } from "./lib/systemPrompts";
import { supportsTools, toDefinition, toolDefinitionValidator } from "./lib/toolSet";

// Keepalive (spec phase 2): while the owner is in a thread, refresh its 5-minute cache shortly
// before it expires, so pausing to read doesn't make the next turn a full cache write.
export const KEEPALIVE_AFTER_MS = 4.5 * 60_000; // after the touch the job keeps alive

export const touchedCache = (usage: Usage) =>
  usage.cacheReadTokens + usage.cacheWriteTokens5m + usage.cacheWriteTokens1h >
  0;

// After a condense (spec phase 6): the cached prefix no longer matches, so the thread reads cold,
// and a keepalive writes the new prefix now if the owner is still in the thread.
export async function warmAfterCondense(
  ctx: MutationCtx,
  thread: Doc<"threads">,
) {
  if (await keepalivePending(ctx, thread))
    await ctx.scheduler.cancel(thread.keepaliveJobId!);
  const keepaliveJobId = await ctx.scheduler.runAfter(
    0,
    internal.chatActions.keepalive,
    { threadId: thread._id, warm: true },
  );
  await ctx.db.patch("threads", thread._id, {
    cacheTouchedAt: undefined,
    keepaliveJobId,
  });
}

// Whether this thread has a keepalive job still waiting to run.
export async function keepalivePending(ctx: QueryCtx, thread: Doc<"threads">) {
  if (!thread.keepaliveJobId) return false;
  const job = await ctx.db.system.get(
    "_scheduled_functions",
    thread.keepaliveJobId,
  );
  return job?.state.kind === "pending";
}

// After a reply: cancel any pending keepalive, then schedule one from this reply's cache
// touch (none if it didn't touch the cache or keepalive is off). One job per thread, however
// many tabs are open.
export async function restartKeepalive(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  touchedAt: number | null,
) {
  if (await keepalivePending(ctx, thread))
    await ctx.scheduler.cancel(thread.keepaliveJobId!);
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", thread.ownerId))
    .unique();
  const keepaliveJobId =
    touchedAt === null || settings?.keepaliveEnabled === false
      ? undefined
      : await ctx.scheduler.runAt(
          touchedAt + KEEPALIVE_AFTER_MS,
          internal.chatActions.keepalive,
          { threadId: thread._id },
        );
  await ctx.db.patch("threads", thread._id, { keepaliveJobId });
}

const providerFields = v.object({
  baseUrl: v.string(),
  apiKeyEncrypted: v.string(),
});

// What the keepalive action sends, or null when any condition says it can't help:
// keepalive is off, the owner is over their daily budget, the thread is gone, its provider isn't Anthropic style, the latest reply is streaming or
// didn't report caching, the owner was last active over 30 minutes ago, or the cache is cold.
// `warm` (right after a condense changed the prefix, spec phase 6) runs on a cold cache too, so
// the new prefix is written before the owner's next send. `now` comes from the action because
// queries must not read the clock.
export const input = internalQuery({
  args: {
    threadId: v.id("threads"),
    now: v.number(),
    warm: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      providerId: v.id("providers"),
      provider: providerFields,
      model: v.string(),
      effort: v.optional(effortValidator),
      system: v.string(),
      history: v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
          effort: v.optional(effortValidator),
          images: v.optional(v.array(imageValidator)),
        }),
      ),
      layerEnd: v.number(),
      tools: v.optional(v.array(toolDefinitionValidator)), // the thread's frozen tools: same prefix as a real turn
      ttl: cacheTtlValidator,
      allowlist: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { threadId, now, warm }) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread?.activeLeafId) return null;
    const provider = await ctx.db.get("providers", thread.providerId);
    if (provider?.apiStyle !== "anthropic") return null;
    // The thread's cache ends at its latest reply from the thread's own model: a cheaper reply
    // after it was cached for another model (spec phase 7).
    const branch = await activeBranch(ctx, thread);
    const leaf = branch.findLast(
      (m) => m.role === "assistant" && !isCheaperReply(m, thread),
    );
    if (
      !leaf ||
      leaf.role !== "assistant" ||
      leaf.status === "streaming" ||
      !leaf.usage ||
      !touchedCache(leaf.usage)
    )
      return null;
    if (
      thread.lastActiveAt === undefined ||
      now - thread.lastActiveAt > ACTIVE_WINDOW_MS
    )
      return null;
    if (!warm && cacheState(cacheExpiresAt(thread), now).state !== "warm")
      return null;

    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", thread.ownerId))
      .unique();
    if (settings?.keepaliveEnabled === false) return null;
    if (await budgetReached(ctx, settings, now)) return null; // upkeep pauses while over budget
    const history = await assembleHistory(ctx, thread._id, [
      ...leaf.ancestorIds,
      leaf._id,
    ]);
    return {
      providerId: provider._id,
      provider: {
        baseUrl: provider.baseUrl,
        apiKeyEncrypted: provider.apiKeyEncrypted,
      },
      model: thread.modelId,
      effort: effortFor(thread, provider), // the same parameters as a real turn
      system: systemPrompt(thread.systemPromptVersion, thread.instructions),
      history: history.messages,
      layerEnd: history.layerEnd,
      tools:
        thread.toolSet?.length && supportsTools(provider, thread.modelId)
          ? thread.toolSet.map(toDefinition)
          : undefined,
      ttl: thread.cacheTtl ?? "5m",
      allowlist: settings?.allowlistedHosts ?? [],
    };
  },
});

// Meters a keepalive as a side job. A sent one refreshes the thread's cache touch and schedules
// the next; a failed one changes nothing else, and the next reply restarts the cycle.
export const record = internalMutation({
  args: {
    threadId: v.id("threads"),
    providerId: v.id("providers"),
    model: v.string(),
    startedAt: v.number(),
    ttl: cacheTtlValidator,
    sent: v.boolean(),
    usage: v.optional(usageValidator),
    reports: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
    reportedCostMicroUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      threadId,
      providerId,
      model,
      startedAt,
      ttl,
      sent,
      usage,
      reports,
      reportedCostMicroUsd,
    },
  ) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread) return null; // deleted meanwhile
    if (usage) {
      const cost = await meterCall(ctx, {
        ownerId: thread.ownerId,
        threadId,
        providerId,
        model,
        normalized: { usage, reports, reportedCostMicroUsd },
        upkeep: true,
      });
      await ctx.db.insert("sideJobs", {
        ownerId: thread.ownerId,
        threadId,
        kind: "keepalive",
        providerId,
        model,
        usage,
        costMicroUsd: cost ?? undefined,
      });
    }
    if (!sent) return null;
    // This job is the one running, so nothing is pending to cancel: just schedule the next.
    const keepaliveJobId = await ctx.scheduler.runAt(
      startedAt + KEEPALIVE_AFTER_MS,
      internal.chatActions.keepalive,
      { threadId },
    );
    await ctx.db.patch("threads", threadId, {
      cacheTouchedAt: startedAt,
      cacheTtl: ttl,
      keepaliveJobId,
    });
    return null;
  },
});
