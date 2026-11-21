import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import {
  activeBranch,
  cheapestPricedModel,
  effortFor,
  isCheaperReply,
} from "./chat";
import { supportsPerMessageEffort } from "./lib/anthropic";
import { effortValidator } from "./lib/effort";
import {
  cacheExpiresAt,
  cacheState,
  cacheTtlValidator,
  requestCacheTtl,
} from "./lib/cacheStatus";
import { threadState } from "./threadState";
import { assembleHistory } from "./lib/context";
import { condensePending, condensePlan } from "./condense";
import { imageTokens } from "./lib/images";
import {
  CURRENT_SYSTEM_PROMPT_VERSION,
  systemPrompt,
} from "./lib/systemPrompts";
import { savedFor } from "./lib/metering";
import {
  priceFor,
  USAGE_FIELDS,
  usageValidator,
  type Usage,
} from "./lib/usage";
import { freezeTools, supportsTools, toDefinition } from "./lib/toolSet";
import { requireOwner } from "./owner";
import { SEARCH_TOKENS_ESTIMATE } from "./lib/webSearch";

// Rough token count for text no provider has measured (characters ÷ 4; spec phase 3).
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
// A message's estimate: its text plus its images (spec phase 4).
const estimateMessage = (m: {
  content: string;
  images?: { width: number; height: number }[];
  search?: boolean;
  documents?: { tokens: number }[];
}) =>
  estimateTokens(m.content) +
  (m.images ?? []).reduce((sum, i) => sum + imageTokens(i), 0) +
  (m.search ? SEARCH_TOKENS_ESTIMATE : 0) +
  (m.documents ?? []).reduce((sum, d) => sum + d.tokens, 0);
const totalInput = (u: Usage) =>
  u.inputTokens +
  u.cacheReadTokens +
  u.cacheWriteTokens5m +
  u.cacheWriteTokens1h;
// A reply's last step carries the whole request it measured: earlier steps are inside it.
const lastStepUsage = (m: Doc<"messages">) => m.steps?.at(-1)?.usage ?? m.usage;
const RECENT_REPLIES = 5; // the expected output is the mean of this many latest replies

const layerValidator = v.object({
  kind: v.union(
    v.literal("tools"),
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
export function nextPrices(
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

// The cost strip on a new thread: the system prompt and the draft go out as fresh input. Also
// the provider's cheapest priced model, for the starting-model suggestion (spec phase 7).
export const newThread = query({
  args: { providerId: v.id("providers"), modelId: v.string() },
  returns: v.object({
    systemTokens: v.number(),
    prices: pricesValidator,
    cheapest: v.union(
      v.null(),
      v.object({
        modelId: v.string(),
        name: v.string(),
        prices: pricesValidator,
      }),
    ),
  }),
  handler: async (ctx, { providerId, modelId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      return { systemTokens: 0, prices: null, cheapest: null };
    const cheapest = cheapestPricedModel(provider);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    return {
      systemTokens: estimateTokens(
        systemPrompt(
          CURRENT_SYSTEM_PROMPT_VERSION,
          settings?.customInstructions,
        ),
      ),
      prices: nextPrices(provider, modelId, "5m"),
      cheapest: cheapest
        ? {
            modelId: cheapest.id,
            name: cheapest.displayName,
            prices: nextPrices(provider, cheapest.id, "5m"),
          }
        : null,
    };
  },
});

// Everything the inspector, the cost strip and the cache-break hints show for a thread, priced,
// so the client only formats. The cache's expiry and keepalive come from threadState.cache, so
// presence doesn't re-run this.
export const get = query({
  args: { threadId: v.id("threads") },
  returns: v.union(
    v.null(),
    v.object({
      cache: v.object({
        managed: v.boolean(), // Anthropic style: tally.chat places the breakpoints
        ttl: cacheTtlValidator, // the lifetime the next send asks for
        lastReadTokens: v.union(v.null(), v.number()), // the latest reply's reported cache read
      }),
      effort: v.union(v.null(), effortValidator), // what the next send uses; null outside Anthropic style
      perMessageEffort: v.boolean(), // effort can change per message without breaking the cache
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
      // Automatic condensing (spec phase 6): off, running, last attempt failed, held by the cache
      // veto, or how many more tokens of verbatim turns until the next check condenses.
      condense: v.object({
        state: v.union(
          v.literal("off"),
          v.literal("condensing"),
          v.literal("failed"),
          v.literal("held"),
          v.literal("waiting"),
        ),
        inTokens: v.number(),
        failure: v.optional(v.string()),
        paybackTurns: v.optional(v.number()), // held: turns the condense needs to pay for itself
      }),
      // Condense now, when there's a turn to fold: its estimated one-off cost (summary plus cache
      // rewrite; null when it can't be priced) and payback. null when it isn't available.
      condenseNow: v.union(
        v.null(),
        v.object({
          costMicroUsd: v.union(v.null(), v.number()),
          paybackTurns: v.union(v.null(), v.number()),
        }),
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
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique();
    const ttl = requestCacheTtl(settings?.keepaliveEnabled, branch.length + 1);
    const prices = nextPrices(provider, thread.modelId, ttl);
    const recent = replies.slice(-RECENT_REPLIES);

    return {
      cache: {
        managed: provider?.apiStyle === "anthropic",
        ttl,
        lastReadTokens:
          (() => {
            const reply = replies.findLast((m) => !isCheaperReply(m, thread));
            return reply ? (lastStepUsage(reply)?.cacheReadTokens ?? null) : null;
          })(),
      },
      // The level in force for the next send: the latest per-message change, else the thread's.
      effort: effortFor(thread, provider)
        ? (branch.findLast((m) => m.role === "user" && m.effort)?.effort ??
          effortFor(thread, provider)!)
        : null,
      perMessageEffort:
        provider?.apiStyle === "anthropic" &&
        supportsPerMessageEffort(thread.modelId),
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
      condense: await condenseStatus(ctx, thread, branch),
      condenseNow: await condenseNowEstimate(ctx, thread, branch),
      thread: await threadFigures(ctx, ownerId, threadId),
    };
  },
});

const NEVER_PAYS_BACK = 1000;

async function condenseNowEstimate(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
) {
  if (branch.some((m) => (m.status === "streaming" || m.status === "waiting"))) return null;
  const plan = await condensePlan(ctx, thread, branch, true);
  if (plan.kind !== "ready") return null;
  return {
    costMicroUsd:
      plan.costUsd === null
        ? null
        : Math.round(Math.max(0, plan.costUsd) * 1e6),
    paybackTurns:
      plan.paybackTurns === null
        ? null
        : Math.min(plan.paybackTurns, NEVER_PAYS_BACK),
  };
}

async function condenseStatus(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
) {
  const plan = await condensePlan(ctx, thread, branch);
  const { inTokens } = plan;
  if (plan.kind === "off") return { state: "off" as const, inTokens };
  if (await condensePending(ctx, thread))
    return { state: "condensing" as const, inTokens };
  if (thread.condenseFailure)
    return {
      state: "failed" as const,
      inTokens,
      failure: thread.condenseFailure,
    };
  if (plan.kind === "held")
    return {
      state: "held" as const,
      inTokens,
      paybackTurns: Math.min(plan.paybackTurns, NEVER_PAYS_BACK), // Infinity isn't a Convex value
    };
  return { state: "waiting" as const, inTokens };
}

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
  // Tools and the system prompt both sit before everything else and stay cached through a fork.
  const system = layers
    .filter((l) => l.kind === "tools" || l.kind === "system")
    .reduce((sum, l) => sum + l.tokens, 0);
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
    // From the checkpoint on, requests carry the checkpoint layer instead of the folded turns.
    if (checkpoint && i === cut) before = system + checkpointLayer;
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
    // A reply measures the request it answered; one sent before the checkpoint can't measure
    // the turns after it (its request still held the folded turns).
    const measures =
      m.role === "assistant" &&
      m.usage &&
      (i < cut || !checkpoint || m._creationTime > checkpoint._creationTime);
    before = measures
      ? totalInput(lastStepUsage(m)!) +
        lastStepUsage(m)!.outputTokens -
        lastStepUsage(m)!.reasoningTokens
      : before + estimateMessage(m);
  }
  return hints;
}

// The context window the next send repeats, by layer: the system prompt, the checkpoint layer
// (when one applies) and the turns since. Turns are measured from the latest reply's usage:
// its request size plus its visible output (thinking isn't replayed), minus the layers before
// them. Messages after that reply, or a branch with no measured reply yet, are estimated.
export async function contextLayers(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  branch: Doc<"messages">[],
) {
  const system = estimateTokens(
    systemPrompt(thread.systemPromptVersion, thread.instructions) ?? "",
  );
  // The thread's frozen tool definitions go first in every request (spec phase 10).
  const toolTokens = thread.toolSet?.length
    ? estimateTokens(JSON.stringify(thread.toolSet.map(toDefinition)))
    : 0;
  const layers: {
    kind: "tools" | "system" | "checkpoint" | "turns";
    label: string;
    tokens: number;
    estimated: boolean;
  }[] = [
    ...(toolTokens
      ? [
          {
            kind: "tools" as const,
            label: `${thread.toolSet!.length} ${thread.toolSet!.length === 1 ? "tool" : "tools"}`,
            tokens: toolTokens,
            estimated: true,
          },
        ]
      : []),
    { kind: "system", label: "system prompt", tokens: system, estimated: true },
  ];
  if (branch.length === 0) return layers;

  const history = await assembleHistory(
    ctx,
    thread._id,
    branch.map((m) => m._id),
  );
  const layerText = history.messages.slice(0, history.layerEnd);
  // Turn numbers count user messages on the branch; verbatim turns start after the checkpoint.
  const cut = history.checkpoint
    ? branch.findIndex((m) => m._id === history.checkpoint!.coversUpToId) + 1
    : 0;
  const turnOf = (i: number) =>
    branch.slice(0, i + 1).filter((m) => m.role === "user").length;
  let layerTokens = 0;
  if (history.checkpoint) {
    const pins = layerText.slice(1); // the summary message comes first, then the covered pins
    layerTokens =
      history.checkpoint.tokens +
      pins.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const covered = turnOf(cut - 1);
    layers.push({
      kind: "checkpoint",
      // No-break space and word joiners keep "turns 1–8" on one line when the label wraps.
      label: `summary of ${covered === 1 ? "turn\u00a01" : `turns\u00a01\u2060–\u2060${covered}`}${pins.length ? ` + ${pins.length}\u00a0pinned` : ""}`,
      tokens: layerTokens,
      estimated: pins.length > 0,
    });
  }

  const verbatim = branch.slice(cut).filter((m) => m.content !== "");
  if (verbatim.length === 0) return layers;

  // A reply sent before the latest checkpoint was measured with the turns it folded, so only
  // replies created after the checkpoint can measure the current layout.
  const since = history.checkpoint?._creationTime ?? 0;
  const measuredAt = branch.findLastIndex(
    (m) =>
      m.role === "assistant" &&
      m.usage !== undefined &&
      m._creationTime > since,
  );
  let tokens: number;
  let estimated: boolean;
  if (measuredAt >= cut) {
    const reply = branch[measuredAt];
    const u = lastStepUsage(reply)!;
    const measured =
      totalInput(u) +
      u.outputTokens -
      u.reasoningTokens -
      toolTokens -
      system -
      layerTokens;
    const later = branch
      .slice(measuredAt + 1)
      .reduce((sum, m) => sum + estimateMessage(m), 0);
    tokens = Math.max(0, measured) + later;
    estimated = later > 0;
  } else {
    tokens = verbatim.reduce((sum, m) => sum + estimateMessage(m), 0);
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
  const sideJobs = await ctx.db
    .query("sideJobs")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .take(1000);
  const replyUsage = Object.fromEntries(
    USAGE_FIELDS.map((f) => [
      f,
      all[f] -
        upkeep[f] -
        sideJobs
          .filter((j) => j.kind === "title" || j.kind === "condense")
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
      effort: v.union(v.null(), effortValidator),
      usage: usageValidator,
      costMicroUsd: v.union(v.null(), v.number()),
      savedMicroUsd: v.union(v.null(), v.number()), // null when the model has no price
      // Every step of the reply (spec phase 10): one entry unless it ran tools.
      steps: v.array(
        v.object({ usage: usageValidator, costMicroUsd: v.union(v.null(), v.number()) }),
      ),
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
      effort: m.effort ?? null,
      usage: m.usage,
      costMicroUsd: m.costMicroUsd ?? null,
      steps: (m.steps ?? [{ usage: m.usage, costMicroUsd: m.costMicroUsd }]).map((s) => ({
        usage: s.usage,
        costMicroUsd: s.costMicroUsd ?? null,
      })),
      savedMicroUsd:
        free || priceFor(model)?.input !== undefined
          ? savedFor(free, model, m.usage)
          : null,
    };
  },
});

// What changing a thread's tool set costs (spec phase 10): the definitions are the top of every
// request, so the next one writes the whole prefix again, with the new tools in it. `extra` is that
// rewrite less what the next send would have cost as it is (a cache read while warm), in micro-USD;
// null when the model has no price.
export const toolChange = query({
  args: {
    threadId: v.id("threads"),
    now: v.number(),
    tools: v.array(v.object({ serverId: v.id("toolServers"), tool: v.string() })),
  },
  returns: v.object({
    newToolTokens: v.number(),
    prefixTokens: v.number(), // what the next request repeats, with the new tools
    extraMicroUsd: v.union(v.null(), v.number()),
  }),
  handler: async (ctx, { threadId, now, tools }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId)
      return { newToolTokens: 0, prefixTokens: 0, extraMicroUsd: null };
    const provider = await ctx.db.get("providers", thread.providerId);
    const branch = await activeBranch(ctx, thread);
    const layers = await contextLayers(ctx, thread, branch);
    const servers = await ctx.db
      .query("toolServers")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(100);
    const frozen = freezeTools(servers, tools);
    const newToolTokens = frozen.length
      ? estimateTokens(JSON.stringify(frozen.map(toDefinition)))
      : 0;
    const oldToolTokens = layers.find((l) => l.kind === "tools")?.tokens ?? 0;
    const current = layers.reduce((sum, l) => sum + l.tokens, 0);
    const prefixTokens = current - oldToolTokens + newToolTokens;
    const state = await threadState(ctx, threadId);
    const p = nextPrices(provider, thread.modelId, state?.cacheTtl ?? "5m");
    if (!p) return { newToolTokens, prefixTokens, extraMicroUsd: null };
    // Anthropic-style: the rewrite is a cache write, and continuing reads while the cache is warm.
    // Elsewhere the provider caches on its own: a rewrite pays input prices.
    const managed = provider?.apiStyle === "anthropic";
    const warm = managed
      ? cacheState(cacheExpiresAt(state ?? {}), now).state !== "cold"
      : true;
    const rewrite = prefixTokens * (managed ? p.cacheWrite : p.input);
    const continuing = current * (warm ? p.cacheRead : managed ? p.cacheWrite : p.input);
    return {
      newToolTokens,
      prefixTokens,
      extraMicroUsd: Math.max(0, Math.round((rewrite - continuing) * 1e6)),
    };
  },
});

// What one send (or a retry of `retryOf`) would cost on each of the owner's visible models, for
// the "reply with" and "Retry with…" lists (spec phase 7). The thread's model is priced at its
// cache state at `now` (the client's clock, taken when the list opens); any other model starts
// cold: the whole prefix at the cache-write price on Anthropic-style providers (they get cache
// breakpoints too) or the input price elsewhere. The new message is fresh input and the reply
// the thread's usual length, capped by the output mode. Cheapest first, unpriced (null) last.
export const modelEstimates = query({
  args: {
    threadId: v.id("threads"),
    now: v.number(),
    draftTokens: v.number(), // the draft and its images, estimated by the client (sends only)
    maxOutputTokens: v.number(), // the output mode's limit
    retryOf: v.optional(v.id("messages")),
  },
  returns: v.array(
    v.object({
      providerId: v.id("providers"),
      modelId: v.string(),
      name: v.string(),
      thread: v.boolean(),
      tools: v.boolean(), // can call tools: a thread that uses tools can only be answered by these
      costMicroUsd: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (
    ctx,
    { threadId, now, draftTokens, maxOutputTokens, retryOf },
  ) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return [];
    let branch = await activeBranch(ctx, thread);
    let fresh = draftTokens;
    if (retryOf) {
      // A retry repeats the branch before the reply's question, then the question itself.
      const reply = await ctx.db.get("messages", retryOf);
      if (!reply || reply.threadId !== threadId || !reply.parentId) return [];
      const ids = reply.ancestorIds.slice(0, -1);
      branch = (
        await Promise.all(ids.map((id) => ctx.db.get("messages", id)))
      ).filter((m): m is Doc<"messages"> => m !== null);
      const question = await ctx.db.get("messages", reply.parentId);
      fresh = question ? estimateMessage(question) : 0;
    }
    const prefix = (await contextLayers(ctx, thread, branch)).reduce(
      (sum, l) => sum + l.tokens,
      0,
    );
    const replies = branch
      .filter((m) => m.role === "assistant" && m.usage)
      .slice(-RECENT_REPLIES);
    const output = replies.length
      ? Math.min(
          maxOutputTokens,
          Math.round(
            replies.reduce((sum, m) => sum + m.usage!.outputTokens, 0) /
              replies.length,
          ),
        )
      : 0;
    const state = await threadState(ctx, threadId);
    const warm = cacheState(cacheExpiresAt(state ?? {}), now).state !== "cold";

    const providers = await ctx.db
      .query("providers")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(100);
    const rows = providers.flatMap((provider) =>
      provider.models
        .filter((m) => !m.hidden)
        .map((m) => {
          const own =
            provider._id === thread.providerId && m.id === thread.modelId;
          const anthropic = provider.apiStyle === "anthropic";
          const p = nextPrices(
            provider,
            m.id,
            own ? (state?.cacheTtl ?? "5m") : "5m",
          );
          const historyPrice = !p
            ? 0
            : !anthropic
              ? p.input
              : own && warm
                ? p.cacheRead
                : p.cacheWrite;
          return {
            providerId: provider._id,
            modelId: m.id,
            name: `${provider.name} · ${m.displayName}`,
            thread: own,
            tools: supportsTools(provider, m.id),
            costMicroUsd: p
              ? Math.round(
                  (prefix * historyPrice +
                    fresh * p.input +
                    output * p.output) *
                    1e6,
                )
              : null,
          };
        }),
    );
    // Unpriced last; Infinity - Infinity would be NaN, so compare them apart.
    return rows.sort((a, b) =>
      a.costMicroUsd === null || b.costMicroUsd === null
        ? Number(a.costMicroUsd === null) - Number(b.costMicroUsd === null)
        : a.costMicroUsd - b.costMicroUsd,
    );
  },
});
