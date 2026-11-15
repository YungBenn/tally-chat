import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { activeBranch, sideJobModelFor } from "./chat";
import { contextLayers, nextPrices } from "./inspector";
import { warmAfterCondense } from "./keepalive";
import { budgetReached } from "./lib/budget";
import {
  condenseSettings,
  CONTEXT_WINDOW_SHARE,
  estimateSummaryTokens,
  foldTranscript,
  paybackTurns,
  planFold,
  summaryRequest,
} from "./lib/condense";
import { assembleHistory } from "./lib/context";
import { meterCall } from "./lib/metering";
import { priceFor, usageValidator } from "./lib/usage";
import { requireOwner } from "./owner";

// Condensing (spec phase 6). After a reply, a scheduled side job folds every turn but the most
// recent ones into a checkpoint summary. Messages are never touched (ADR 0001).

const settingsFor = (ctx: QueryCtx, ownerId: Id<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();

// Every message some checkpoint of the thread covers (on any branch): their pin state is fixed,
// because the summary was written around it.
export async function coveredIds(ctx: QueryCtx, threadId: Id<"threads">) {
  const checkpoints = await ctx.db
    .query("checkpoints")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .take(100);
  const covered = new Set<Id<"messages">>();
  for (const c of checkpoints) {
    const last = await ctx.db.get("messages", c.coversUpToId);
    if (!last) continue;
    covered.add(last._id);
    for (const id of last.ancestorIds) covered.add(id);
  }
  return covered;
}

// Pins a message so the condenser never folds it into a summary (spec phase 6), or unpins it.
// Only until a checkpoint covers it. The flag changes no request bytes until then (ADR 0001).
export const setPinned = mutation({
  args: { messageId: v.id("messages"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { messageId, pinned }) => {
    const ownerId = await requireOwner(ctx);
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.ownerId !== ownerId)
      throw new ConvexError("Message not found");
    if ((await coveredIds(ctx, message.threadId)).has(messageId))
      throw new ConvexError(
        "This message is already condensed, so its pin can't change",
      );
    await ctx.db.patch("messages", messageId, { pinned });
    return null;
  },
});

// Whether the thread already has a condense waiting or running.
export async function condensePending(ctx: QueryCtx, thread: Doc<"threads">) {
  if (!thread.condenseJobId) return false;
  const job = await ctx.db.system.get(
    "_scheduled_functions",
    thread.condenseJobId,
  );
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

// After a finished reply: schedule a condense check, unless one is already queued or running.
export async function scheduleCondense(
  ctx: MutationCtx,
  thread: Doc<"threads">,
) {
  if (await condensePending(ctx, thread)) return;
  const condenseJobId = await ctx.scheduler.runAfter(
    0,
    internal.chatActions.condense,
    { threadId: thread._id },
  );
  await ctx.db.patch("threads", thread._id, { condenseJobId });
}

// What a condense check decides for a branch (spec phase 6), shared by the condense job and the
// inspector so both always agree:
// - off: condensing is turned off (and this isn't a forced condense)
// - wait: under the thresholds, or no whole turn can be folded yet; inTokens is how far the
//   verbatim turns are from the threshold (0 when only more turns are missing)
// - held: the cache veto holds it, with the payback estimate in turns
// - ready: fold branch[cut..end] into a new checkpoint
// `force` (condense now) skips the thresholds and the veto, never the kept turns.
export async function condensePlan(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
  force = false,
) {
  const settings = await settingsFor(ctx, thread.ownerId);
  const config = condenseSettings(settings);
  const layers = await contextLayers(ctx, thread, branch);
  const totalTokens = layers.reduce((sum, l) => sum + l.tokens, 0);
  const turnsTokens = layers.find((l) => l.kind === "turns")?.tokens ?? 0;
  const inTokens = Math.max(
    0,
    config.atTokens - turnsTokens,
    config.minThreadTokens - totalTokens,
  );
  if (!config.enabled && !force) return { kind: "off" as const, inTokens };
  if (!force && inTokens > 0) return { kind: "wait" as const, inTokens };

  const { checkpoint } = await assembleHistory(
    ctx,
    thread._id,
    branch.map((m) => m._id),
  );
  const cut = checkpoint
    ? branch.findIndex((m) => m._id === checkpoint.coversUpToId) + 1
    : 0;
  const end = planFold(branch, cut, config.keepTurns);
  const sideJob = await sideJobModelFor(ctx, thread);
  if (end === null || !sideJob) return { kind: "wait" as const, inTokens: 0 };

  // Folded tokens: the measured turns layer, scaled by the share of its text being folded.
  const chars = (ms: Doc<"messages">[]) =>
    ms.reduce((sum, m) => sum + (m.pinned ? 0 : m.content.length), 0);
  const verbatimChars = chars(branch.slice(cut)) || 1;
  const foldedTokens = Math.round(
    (turnsTokens * chars(branch.slice(cut, end + 1))) / verbatimChars,
  );
  const previousSummary = checkpoint?.tokens ?? 0;
  const summaryInputTokens = previousSummary + foldedTokens;
  const summaryTokens = estimateSummaryTokens(summaryInputTokens);
  const provider = await ctx.db.get("providers", thread.providerId);
  const payback = paybackTurns({
    oldPrefixTokens: totalTokens,
    removedTokens: summaryInputTokens - summaryTokens,
    summaryInputTokens,
    summaryTokens,
    caching: provider?.capabilities?.caching === true,
    thread: nextPrices(provider, thread.modelId, thread.cacheTtl ?? "5m"),
    side: sidePrices(sideJob.provider, sideJob.model),
  });
  const window = priceFor(thread.modelId)?.contextWindow;
  const nearWindow =
    window !== undefined && totalTokens >= window * CONTEXT_WINDOW_SHARE;
  if (
    !force &&
    !nearWindow &&
    payback !== null &&
    payback > config.paybackTurns
  )
    return { kind: "held" as const, inTokens: 0, paybackTurns: payback };
  return {
    kind: "ready" as const,
    inTokens: 0,
    paybackTurns: payback,
    cut,
    end,
    checkpoint,
    sideJob,
    settings,
  };
}

// The side-job model's prices: free providers cost nothing; null without a price.
function sidePrices(provider: Doc<"providers">, model: string) {
  if (provider.free === true) return { input: 0, output: 0 };
  const price = priceFor(model);
  return price?.input !== undefined && price.output !== undefined
    ? { input: price.input, output: price.output }
    : null;
}

// What the condense action sends, or null when there's nothing to do: the owner is over budget,
// a reply is streaming, or the plan isn't ready (see condensePlan). `now` comes from the action
// because queries must not read the clock.
export const input = internalQuery({
  args: {
    threadId: v.id("threads"),
    now: v.number(),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      coversUpToId: v.id("messages"),
      request: v.string(),
      providerId: v.id("providers"),
      provider: v.object({
        apiStyle: v.union(
          v.literal("anthropic"),
          v.literal("openai-compatible"),
        ),
        baseUrl: v.string(),
        apiKeyEncrypted: v.string(),
      }),
      model: v.string(),
      allowlist: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { threadId, now, force }) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread) return null;
    const branch = await activeBranch(ctx, thread);
    if (branch.some((m) => m.status === "streaming")) return null;
    const plan = await condensePlan(ctx, thread, branch, force);
    if (plan.kind !== "ready") return null;
    if (await budgetReached(ctx, plan.settings, now)) return null; // side jobs pause while over budget
    const { cut, end, checkpoint, sideJob } = plan;
    const { apiStyle, baseUrl, apiKeyEncrypted } = sideJob.provider;
    return {
      coversUpToId: branch[end]._id,
      request: summaryRequest(
        checkpoint?.summary ?? null,
        foldTranscript(branch.slice(cut, end + 1)),
      ),
      providerId: sideJob.provider._id,
      provider: { apiStyle, baseUrl, apiKeyEncrypted },
      model: sideJob.model,
      allowlist: plan.settings?.allowlistedHosts ?? [],
    };
  },
});

// Saves a summary as the thread's new checkpoint, or records why there isn't one, and meters
// the side job whenever the provider reported usage.
export const save = internalMutation({
  args: {
    threadId: v.id("threads"),
    coversUpToId: v.id("messages"),
    providerId: v.id("providers"),
    model: v.string(),
    summary: v.optional(v.string()),
    failure: v.optional(v.string()),
    usage: v.optional(usageValidator),
    reports: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
    reportedCostMicroUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get("threads", args.threadId);
    if (!thread) return null; // deleted meanwhile: nothing left to condense or bill against
    if (args.usage) {
      const cost = await meterCall(ctx, {
        ownerId: thread.ownerId,
        threadId: thread._id,
        providerId: args.providerId,
        model: args.model,
        normalized: {
          usage: args.usage,
          reports: args.reports,
          reportedCostMicroUsd: args.reportedCostMicroUsd,
        },
      });
      await ctx.db.insert("sideJobs", {
        ownerId: thread.ownerId,
        threadId: thread._id,
        kind: "condense",
        providerId: args.providerId,
        model: args.model,
        usage: args.usage,
        costMicroUsd: cost ?? undefined,
      });
    }
    const covered = await ctx.db.get("messages", args.coversUpToId);
    if (!args.summary || !covered) {
      await ctx.db.patch("threads", thread._id, {
        condenseFailure: args.failure ?? "the covered messages are gone",
      });
      return null;
    }
    await ctx.db.insert("checkpoints", {
      ownerId: thread.ownerId,
      threadId: thread._id,
      coversUpToId: args.coversUpToId,
      summary: args.summary,
      tokens: args.usage?.outputTokens || Math.ceil(args.summary.length / 4),
    });
    await ctx.db.patch("threads", thread._id, { condenseFailure: undefined });
    await warmAfterCondense(ctx, thread);
    return null;
  },
});
