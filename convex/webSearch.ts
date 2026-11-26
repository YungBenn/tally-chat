import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { sideJobModelFor } from "./chat";
import { ancestorIds } from "./lib/ancestors";
import { budgetReached } from "./lib/budget";
import { meterCall } from "./lib/metering";
import { recordDailyUsage } from "./lib/rollups";
import { USAGE_FIELDS, usageValidator, type Usage } from "./lib/usage";
import { REWRITE_TURNS, searchQuery, searchResultValidator } from "./lib/webSearch";

// The search a reply waits for: its user message asked to search and has no successful search
// stored. A retry or a later turn reuses a successful one, so its bytes never change; a failed
// one runs again, so a fixed key helps the retry.
export const pending = internalQuery({
  args: { replyId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({
      messageId: v.id("messages"),
      ownerId: v.id("users"),
      threadId: v.id("threads"),
      query: v.string(),
      // The Exa key's ciphertext; null: the key was removed after the message.
      keyEncrypted: v.union(v.null(), v.string()),
      // What the query rewrite reads; null: no side-job model, or the budget is reached, so the
      // raw message is the query.
      rewrite: v.union(
        v.null(),
        v.object({
          turns: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), text: v.string() })),
          message: v.string(),
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
    }),
  ),
  handler: async (ctx, { replyId }) => {
    const reply = await ctx.db.get("messages", replyId);
    const user = reply?.parentId
      ? await ctx.db.get("messages", reply.parentId)
      : null;
    if (!user?.search) return null;
    const done = await ctx.db
      .query("searches")
      .withIndex("by_messageId", (q) => q.eq("messageId", user._id))
      .unique();
    if (done && !done.error) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user.ownerId))
      .unique();
    const thread = await ctx.db.get("threads", user.threadId);
    const sideJob = thread && (await sideJobModelFor(ctx, thread));
    let rewrite = null;
    // Side jobs pause while over budget, like titles.
    if (sideJob && !(await budgetReached(ctx, settings, Date.now()))) {
      const before = (await ancestorIds(ctx, user)).slice(-REWRITE_TURNS);
      const turns = [];
      for (const id of before) {
        const m = await ctx.db.get("messages", id);
        if (m && m.content && (m.role === "user" || m.role === "assistant")) turns.push({ role: m.role, text: m.content });
      }
      const { apiStyle, baseUrl, apiKeyEncrypted } = sideJob.provider;
      rewrite = {
        turns,
        message: user.content,
        providerId: sideJob.provider._id,
        provider: { apiStyle, baseUrl, apiKeyEncrypted },
        model: sideJob.model,
        allowlist: settings?.allowlistedHosts ?? [],
      };
    }
    return {
      messageId: user._id,
      ownerId: user.ownerId,
      threadId: user.threadId,
      query: searchQuery(user.content),
      keyEncrypted: settings?.searchKeyEncrypted ?? null,
      rewrite,
    };
  },
});

// Meters the query rewrite as a side job and returns its cost. A deleted thread has nothing left
// to bill against, like a title.
export const saveRewrite = internalMutation({
  args: {
    threadId: v.id("threads"),
    providerId: v.id("providers"),
    model: v.string(),
    usage: usageValidator,
    reports: v.optional(v.object({ caching: v.boolean(), reasoning: v.boolean() })),
    reportedCostMicroUsd: v.optional(v.number()),
  },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, { threadId, providerId, model, usage, reports, reportedCostMicroUsd }) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread) return null;
    const cost = await meterCall(ctx, {
      ownerId: thread.ownerId,
      threadId,
      providerId,
      model,
      normalized: { usage, reports, reportedCostMicroUsd },
    });
    await ctx.db.insert("sideJobs", {
      ownerId: thread.ownerId,
      threadId,
      kind: "rewrite",
      providerId,
      model,
      usage,
      costMicroUsd: cost ?? undefined,
    });
    return cost;
  },
});

export const save = internalMutation({
  args: {
    messageId: v.id("messages"),
    // From pending: the message may be gone by now, and a successful search is still billed.
    ownerId: v.id("users"),
    threadId: v.id("threads"),
    query: v.string(),
    queries: v.optional(v.array(v.string())),
    results: v.array(searchResultValidator),
    error: v.optional(v.string()),
    costMicroUsd: v.optional(v.number()),
    rewriteCostMicroUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, ownerId, threadId, ...search }) => {
    const message = await ctx.db.get("messages", messageId);
    // Gone: the thread was deleted mid-search, so there's nothing to store it on.
    if (message) {
      const existing = await ctx.db
        .query("searches")
        .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
        .unique();
      if (existing && !existing.error) return null;
      if (existing) await ctx.db.delete("searches", existing._id);
      await ctx.db.insert("searches", { ownerId, messageId, ...search });
    }
    // A successful search is a metered call in the same mutation, so totals never drift from
    // their searches. Zero usage keeps hit rate and savings about caching; no cost is unpriced.
    if (!search.error) {
      const settings = await ctx.db
        .query("settings")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .unique();
      await recordDailyUsage(ctx, {
        ownerId,
        at: Date.now(),
        timeZone: settings?.timeZone,
        model: "exa-search",
        providerId: "exa",
        threadId,
        usage: Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0])) as Usage,
        costMicroUsd: search.costMicroUsd ?? null,
        savedMicroUsd: 0,
        upkeep: false,
      });
    }
    return null;
  },
});
