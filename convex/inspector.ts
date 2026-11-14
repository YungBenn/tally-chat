import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { activeBranch } from "./chat";
import { cacheExpiresAt, cacheTtlValidator } from "./lib/cacheStatus";
import { assembleHistory } from "./lib/context";
import {
  CURRENT_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPTS,
} from "./lib/systemPrompts";
import { savedFor } from "./lib/metering";
import {
  priceFor,
  USAGE_FIELDS,
  usageValidator,
  type Usage,
} from "./lib/usage";
import { requireOwner } from "./owner";

// Rough token count for text no provider has measured (characters ÷ 4; spec phase 3).
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
const totalInput = (u: Usage) =>
  u.inputTokens +
  u.cacheReadTokens +
  u.cacheWriteTokens5m +
  u.cacheWriteTokens1h;
const RECENT_REPLIES = 5; // the expected output is the mean of this many latest replies

const layerValidator = v.object({
  kind: v.union(
    v.literal("system"),
    v.literal("checkpoint"),
    v.literal("turns"),
  ),
  label: v.string(),
  tokens: v.number(),
  estimated: v.boolean(),
});

// USD per token for the next send; null when the model has no price. Free providers are all 0.
const pricesValidator = v.union(
  v.null(),
  v.object({
    input: v.number(),
    output: v.number(),
    cacheRead: v.number(),
    cacheWrite: v.number(),
  }),
);

// USD per token for a send on this model; all 0 on a free provider, null without a price.
// Without cache prices, a cached token is priced like an uncached one.
function nextPrices(
  provider: Doc<"providers"> | null,
  modelId: string,
  ttl: "5m" | "1h",
) {
  if (provider?.free === true)
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const price = priceFor(modelId);
  if (price?.input === undefined || price.output === undefined) return null;
  return {
    input: price.input,
    output: price.output,
    cacheRead: price.cacheRead ?? price.input,
    cacheWrite:
      (ttl === "1h" ? price.cacheWrite1h : price.cacheWrite5m) ?? price.input,
  };
}

// The cost strip on a new thread: the system prompt and the draft go out as fresh input.
export const newThread = query({
  args: { providerId: v.id("providers"), modelId: v.string() },
  returns: v.object({ systemTokens: v.number(), prices: pricesValidator }),
  handler: async (ctx, { providerId, modelId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      return { systemTokens: 0, prices: null };
    return {
      systemTokens: estimateTokens(
        SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION],
      ),
      prices: nextPrices(provider, modelId, "5m"),
    };
  },
});

// Everything the inspector, the cost strip and the cache-break hints show for a thread, priced,
// so the client only formats. Queries can't read the clock, so cache state comes back as times
// for the client to judge with lib/cacheStatus.
export const get = query({
  args: { threadId: v.id("threads") },
  returns: v.union(
    v.null(),
    v.object({
      cache: v.object({
        managed: v.boolean(), // Anthropic style: tally.chat places the breakpoints
        expiresAt: v.union(v.null(), v.number()),
        keepaliveScheduled: v.boolean(),
        lastActiveAt: v.union(v.null(), v.number()),
        ttl: cacheTtlValidator,
        lastReadTokens: v.union(v.null(), v.number()), // the latest reply's reported cache read
      }),
      layers: v.array(layerValidator),
      next: v.object({
        prefixTokens: v.number(), // everything the next send repeats before the new message
        prices: pricesValidator,
        expectedOutputTokens: v.union(v.null(), v.number()),
      }),
      // Per user message on the branch: roughly how much more editing it costs than
      // continuing, when that's at least a cent. The client hides them while the cache is cold.
      editHints: v.array(
        v.object({ messageId: v.id("messages"), extraMicroUsd: v.number() }),
      ),
      thread: v.object({
        costMicroUsd: v.number(),
        unpricedCalls: v.number(),
        upkeepMicroUsd: v.number(),
        hitRate: v.union(v.null(), v.number()), // 0..1 over replies; null before any input
        savedMicroUsd: v.number(), // replies' read discount minus write premium, minus upkeep
        reasoningTokens: v.number(),
      }),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    const provider = await ctx.db.get("providers", thread.providerId);
    const branch = await activeBranch(ctx, thread);
    const replies = branch.filter((m) => m.role === "assistant" && m.usage);

    const layers = await contextLayers(ctx, thread, branch);
    const ttl = thread.cacheTtl ?? "5m";
    const prices = nextPrices(provider, thread.modelId, ttl);
    const recent = replies.slice(-RECENT_REPLIES);

    return {
      cache: {
        managed: provider?.apiStyle === "anthropic",
        expiresAt: cacheExpiresAt(thread),
        keepaliveScheduled: thread.keepaliveJobId
          ? (
              await ctx.db.system.get(
                "_scheduled_functions",
                thread.keepaliveJobId,
              )
            )?.state.kind === "pending"
          : false,
        lastActiveAt: thread.lastActiveAt ?? null,
        ttl,
        lastReadTokens: replies.at(-1)?.usage?.cacheReadTokens ?? null,
      },
      layers,
      next: {
        prefixTokens: layers.reduce((sum, l) => sum + l.tokens, 0),
        prices,
        expectedOutputTokens: recent.length
          ? Math.round(
              recent.reduce((sum, m) => sum + m.usage!.outputTokens, 0) /
                recent.length,
            )
          : null,
      },
      editHints:
        provider?.apiStyle === "anthropic" && prices
          ? await editHints(ctx, thread, branch, layers, prices)
          : [],
      thread: await threadFigures(ctx, ownerId, threadId),
    };
  },
});

const MIN_CACHEABLE_TOKENS = 512; // every 5.x model; shorter prefixes never cache (design doc S5)
const MIN_HINT_MICRO_USD = 10_000; // under a cent isn't worth a hint

// Editing a past message forks there: the new request repeats the branch up to that message.
// Assume only the explicit-breakpoint layers (system prompt, checkpoint layer) are still cached,
// since older cache entries expire, so everything after them up to the message is a cache write.
// Compared with continuing (the whole prefix read from cache), that's the extra cost. It can
// overstate a very recent edit; it never understates one.
async function editHints(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
  layers: { kind: string; tokens: number }[],
  p: { cacheRead: number; cacheWrite: number },
) {
  const prefix = layers.reduce((sum, l) => sum + l.tokens, 0);
  if (prefix < MIN_CACHEABLE_TOKENS) return [];
  const system = layers[0].tokens;
  const checkpointLayer =
    layers.find((l) => l.kind === "checkpoint")?.tokens ?? 0;
  const { checkpoint } = await assembleHistory(
    ctx,
    thread._id,
    branch.map((m) => m._id),
  );
  const cut = checkpoint
    ? branch.findIndex((m) => m._id === checkpoint.coversUpToId) + 1
    : 0;
  const continuing = prefix * p.cacheRead;

  const hints: { messageId: Id<"messages">; extraMicroUsd: number }[] = [];
  let before = system; // tokens of the request before branch[i], measured where a reply allows
  for (let i = 0; i < branch.length; i++) {
    const m = branch[i];
    if (m.role === "user") {
      // A fork inside the checkpoint's range loses the checkpoint: only the system prompt stays.
      const stable = i < cut ? system : system + checkpointLayer;
      const rewrite = Math.max(0, before - stable);
      const extra = Math.round(
        (stable * p.cacheRead + rewrite * p.cacheWrite - continuing) * 1e6,
      );
      if (extra >= MIN_HINT_MICRO_USD)
        hints.push({ messageId: m._id, extraMicroUsd: extra });
    }
    before =
      m.role === "assistant" && m.usage
        ? totalInput(m.usage) + m.usage.outputTokens - m.usage.reasoningTokens
        : before + estimateTokens(m.content);
  }
  return hints;
}

// The context window the next send repeats, by layer: the system prompt, the checkpoint layer
// (when one applies) and the turns since. Turns are measured from the latest reply's usage:
// its request size plus its visible output (thinking isn't replayed), minus the layers before
// them. Messages after that reply, or a branch with no measured reply yet, are estimated.
async function contextLayers(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
) {
  const system = estimateTokens(
    SYSTEM_PROMPTS[thread.systemPromptVersion] ?? "",
  );
  const layers: {
    kind: "system" | "checkpoint" | "turns";
    label: string;
    tokens: number;
    estimated: boolean;
  }[] = [
    { kind: "system", label: "system prompt", tokens: system, estimated: true },
  ];
  if (branch.length === 0) return layers;

  const history = await assembleHistory(
    ctx,
    thread._id,
    branch.map((m) => m._id),
  );
  const layerText = history.messages.slice(0, history.layerEnd);
  let layerTokens = 0;
  if (history.checkpoint) {
    const pins = layerText.slice(1); // the summary message comes first, then the covered pins
    layerTokens =
      history.checkpoint.tokens +
      pins.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    layers.push({
      kind: "checkpoint",
      label: `summary${pins.length ? ` + ${pins.length} pinned` : ""}`,
      tokens: layerTokens,
      estimated: pins.length > 0,
    });
  }

  // Turn numbers count user messages on the branch; verbatim turns start after the checkpoint.
  const cut = history.checkpoint
    ? branch.findIndex((m) => m._id === history.checkpoint!.coversUpToId) + 1
    : 0;
  const turnOf = (i: number) =>
    branch.slice(0, i + 1).filter((m) => m.role === "user").length;
  const verbatim = branch.slice(cut).filter((m) => m.content !== "");
  if (verbatim.length === 0) return layers;

  const measuredAt = branch.findLastIndex(
    (m) => m.role === "assistant" && m.usage !== undefined,
  );
  let tokens: number;
  let estimated: boolean;
  if (measuredAt >= cut) {
    const reply = branch[measuredAt];
    const u = reply.usage!;
    const measured =
      totalInput(u) + u.outputTokens - u.reasoningTokens - system - layerTokens;
    const later = branch
      .slice(measuredAt + 1)
      .reduce((sum, m) => sum + estimateTokens(m.content), 0);
    tokens = Math.max(0, measured) + later;
    estimated = later > 0;
  } else {
    tokens = verbatim.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    estimated = true;
  }
  const first = turnOf(cut);
  const last = turnOf(branch.length - 1);
  layers.push({
    kind: "turns",
    label: first === last ? `turn ${first}` : `turns ${first}–${last}`,
    tokens,
    estimated,
  });
  return layers;
}

// Thread totals from the daily rollups (every call metered against it, on any day). Hit rate
// covers replies: the upkeep (keepalive) and title calls are taken out. Savings count what the
// replies' caching saved, minus what keeping the cache warm cost.
async function threadFigures(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  threadId: Id<"threads">,
) {
  const sum = async (dimension: "thread" | "upkeep") => {
    const rows = await ctx.db
      .query("dailyUsage")
      .withIndex("by_owner_dimension_key_day", (q) =>
        q.eq("ownerId", ownerId).eq("dimension", dimension).eq("key", threadId),
      )
      .take(1000);
    const total = {
      costMicroUsd: 0,
      unpricedCalls: 0,
      savedMicroUsd: 0,
      ...(Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0])) as Usage),
    };
    for (const r of rows) {
      total.costMicroUsd += r.costMicroUsd;
      total.unpricedCalls += r.unpricedCalls;
      total.savedMicroUsd += r.savedMicroUsd ?? 0;
      for (const f of USAGE_FIELDS) total[f] += r[f];
    }
    return total;
  };
  const all = await sum("thread");
  const upkeep = await sum("upkeep");
  const titles = await ctx.db
    .query("sideJobs")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .take(1000);
  const replyUsage = Object.fromEntries(
    USAGE_FIELDS.map((f) => [
      f,
      all[f] -
        upkeep[f] -
        titles
          .filter((j) => j.kind === "title")
          .reduce((s, j) => s + j.usage[f], 0),
    ]),
  ) as Usage;
  const input = totalInput(replyUsage);
  return {
    costMicroUsd: all.costMicroUsd,
    unpricedCalls: all.unpricedCalls,
    upkeepMicroUsd: upkeep.costMicroUsd,
    hitRate: input > 0 ? replyUsage.cacheReadTokens / input : null,
    savedMicroUsd:
      all.savedMicroUsd - upkeep.savedMicroUsd - upkeep.costMicroUsd,
    reasoningTokens: all.reasoningTokens,
  };
}

// One reply in the inspector: its stored usage and cost, and what caching saved on it, priced
// the same way as the rollups. null when it isn't the owner's or has no usage.
export const turn = query({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({
      model: v.string(),
      usage: usageValidator,
      costMicroUsd: v.union(v.null(), v.number()),
      savedMicroUsd: v.union(v.null(), v.number()), // null when the model has no price
    }),
  ),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    const m = await ctx.db.get("messages", messageId);
    if (!m || m.ownerId !== ownerId || !m.usage) return null;
    const provider = m.providerId
      ? await ctx.db.get("providers", m.providerId)
      : null;
    const free = provider?.free === true;
    const model = m.model ?? "";
    const name =
      provider?.models.find((x) => x.id === model)?.displayName ?? model;
    return {
      model: name,
      usage: m.usage,
      costMicroUsd: m.costMicroUsd ?? null,
      savedMicroUsd:
        free || priceFor(model)?.input !== undefined
          ? savedFor(free, model, m.usage)
          : null,
    };
  },
});
