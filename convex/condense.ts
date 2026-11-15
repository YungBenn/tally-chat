import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { activeBranch, sideJobModelFor } from "./chat";
import { contextLayers } from "./inspector";
import { warmAfterCondense } from "./keepalive";
import { budgetReached } from "./lib/budget";
import {
  condenseSettings,
  foldTranscript,
  planFold,
  summaryRequest,
} from "./lib/condense";
import { assembleHistory } from "./lib/context";
import { meterCall } from "./lib/metering";
import { usageValidator } from "./lib/usage";

// Condensing (spec phase 6). After a reply, a scheduled side job folds every turn but the most
// recent ones into a checkpoint summary. Messages are never touched (ADR 0001).

const settingsFor = (ctx: QueryCtx, ownerId: Id<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();

// Whether the thread already has a condense waiting or running.
export async function condensePending(ctx: QueryCtx, thread: Doc<"threads">) {
  if (!thread.condenseJobId) return false;
  const job = await ctx.db.system.get("_scheduled_functions", thread.condenseJobId);
  return job?.state.kind === "pending" || job?.state.kind === "inProgress";
}

// After a finished reply: schedule a condense check, unless one is already queued or running.
export async function scheduleCondense(ctx: MutationCtx, thread: Doc<"threads">) {
  if (await condensePending(ctx, thread)) return;
  const condenseJobId = await ctx.scheduler.runAfter(
    0,
    internal.chatActions.condense,
    { threadId: thread._id },
  );
  await ctx.db.patch("threads", thread._id, { condenseJobId });
}

// The measured size of a branch, as the inspector shows it: the whole context, and the verbatim
// turns since the latest checkpoint.
export async function branchSize(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
) {
  const layers = await contextLayers(ctx, thread, branch);
  return {
    totalTokens: layers.reduce((sum, l) => sum + l.tokens, 0),
    turnsTokens: layers.find((l) => l.kind === "turns")?.tokens ?? 0,
  };
}

// What the condense action sends, or null when there's nothing to do: condensing is off, the
// owner is over budget, a reply is streaming, the thread is under the thresholds, or no whole
// turn can be folded. `now` comes from the action because queries must not read the clock.
export const input = internalQuery({
  args: { threadId: v.id("threads"), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      coversUpToId: v.id("messages"),
      request: v.string(),
      providerId: v.id("providers"),
      provider: v.object({
        apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
        baseUrl: v.string(),
        apiKeyEncrypted: v.string(),
      }),
      model: v.string(),
      allowlist: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { threadId, now }) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread) return null;
    const settings = await settingsFor(ctx, thread.ownerId);
    const config = condenseSettings(settings);
    if (!config.enabled) return null;
    if (await budgetReached(ctx, settings, now)) return null; // side jobs pause while over budget
    const branch = await activeBranch(ctx, thread);
    if (branch.some((m) => m.status === "streaming")) return null;

    const size = await branchSize(ctx, thread, branch);
    if (size.totalTokens < config.minThreadTokens) return null;
    if (size.turnsTokens < config.atTokens) return null;

    const { checkpoint } = await assembleHistory(
      ctx,
      threadId,
      branch.map((m) => m._id),
    );
    const cut = checkpoint
      ? branch.findIndex((m) => m._id === checkpoint.coversUpToId) + 1
      : 0;
    const end = planFold(branch, cut, config.keepTurns);
    if (end === null) return null;

    const sideJob = await sideJobModelFor(ctx, thread);
    if (!sideJob) return null;
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
      allowlist: settings?.allowlistedHosts ?? [],
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
    reports: v.optional(v.object({ caching: v.boolean(), reasoning: v.boolean() })),
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
