import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { condenseSettings } from "./lib/condense";
import { dayIn } from "./lib/rollups";
import { requireOwner } from "./owner";

const settingsFor = (ctx: QueryCtx, ownerId: Id<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();

// Accepts "host" or "host:port" (IPv6 in brackets); no scheme, path or credentials.
function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase();
  let url: URL;
  try {
    url = new URL(`http://${raw}`);
  } catch {
    throw new ConvexError("Enter a host like 192.168.1.20 or ollama.lan:11434");
  }
  if (url.host !== raw || url.pathname !== "/" || !url.hostname) {
    throw new ConvexError("Enter a host like 192.168.1.20 or ollama.lan:11434");
  }
  return url.host;
}

const sideJobModelValidator = v.object({
  providerId: v.id("providers"),
  modelId: v.string(),
});

export const get = query({
  args: {},
  returns: v.object({
    allowlistedHosts: v.array(v.string()),
    sideJobModel: v.union(v.null(), sideJobModelValidator),
    timeZone: v.union(v.null(), v.string()),
    keepaliveEnabled: v.boolean(),
    cacheBreakConfirmMicroUsd: v.number(),
    dailyBudgetMicroUsd: v.union(v.null(), v.number()),
    condense: v.object({
      enabled: v.boolean(),
      atTokens: v.number(),
      keepTurns: v.number(),
    }),
  }),
  handler: async (ctx) => {
    const settings = await settingsFor(ctx, await requireOwner(ctx));
    return {
      allowlistedHosts: settings?.allowlistedHosts ?? [],
      sideJobModel: settings?.sideJobModel ?? null,
      timeZone: settings?.timeZone ?? null,
      keepaliveEnabled: settings?.keepaliveEnabled !== false,
      cacheBreakConfirmMicroUsd:
        settings?.cacheBreakConfirmMicroUsd ?? DEFAULT_CACHE_BREAK_CONFIRM,
      dailyBudgetMicroUsd: settings?.dailyBudgetMicroUsd ?? null,
      condense: (({ enabled, atTokens, keepTurns }) => ({
        enabled,
        atTokens,
        keepTurns,
      }))(condenseSettings(settings)),
    };
  },
});

// Condensing (spec phase 6): on or off, the threshold, and how many recent turns stay verbatim.
// Changes apply from the next condense check.
export const CONDENSE_LIMITS = {
  atTokens: { min: 5_000, max: 500_000 },
  keepTurns: { min: 1, max: 50 },
};
export const setCondense = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    atTokens: v.optional(v.number()),
    keepTurns: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { enabled, atTokens, keepTurns }) => {
    const ownerId = await requireOwner(ctx);
    const inRange = (n: number, { min, max }: { min: number; max: number }) =>
      Number.isInteger(n) && n >= min && n <= max;
    if (atTokens !== undefined && !inRange(atTokens, CONDENSE_LIMITS.atTokens))
      throw new ConvexError("Condense at between 5,000 and 500,000 tokens");
    if (
      keepTurns !== undefined &&
      !inRange(keepTurns, CONDENSE_LIMITS.keepTurns)
    )
      throw new ConvexError("Keep between 1 and 50 turns");
    const fields = {
      ...(enabled !== undefined ? { condenseEnabled: enabled } : {}),
      ...(atTokens !== undefined ? { condenseAtTokens: atTokens } : {}),
      ...(keepTurns !== undefined ? { condenseKeepTurns: keepTurns } : {}),
    };
    const settings = await settingsFor(ctx, ownerId);
    if (settings) await ctx.db.patch("settings", settings._id, fields);
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        ...fields,
      });
    return null;
  },
});

// The day boundary for daily spend. Changing it affects calls from now on, not past days.
export const setTimeZone = mutation({
  args: { timeZone: v.string() },
  returns: v.null(),
  handler: async (ctx, { timeZone }) => {
    const ownerId = await requireOwner(ctx);
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone });
    } catch {
      throw new ConvexError("Unknown time zone");
    }
    const settings = await settingsFor(ctx, ownerId);
    if (settings) await ctx.db.patch("settings", settings._id, { timeZone });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        timeZone,
      });
    return null;
  },
});

// null resets to the default: the cheapest priced model of each thread's provider.
export const setSideJobModel = mutation({
  args: { sideJobModel: v.union(v.null(), sideJobModelValidator) },
  returns: v.null(),
  handler: async (ctx, { sideJobModel }) => {
    const ownerId = await requireOwner(ctx);
    if (sideJobModel) {
      const provider = await ctx.db.get("providers", sideJobModel.providerId);
      if (
        !provider ||
        provider.ownerId !== ownerId ||
        !provider.models.some((m) => m.id === sideJobModel.modelId && !m.hidden)
      ) {
        throw new ConvexError("Model not available");
      }
    }
    const settings = await settingsFor(ctx, ownerId);
    if (settings)
      await ctx.db.patch("settings", settings._id, {
        sideJobModel: sideJobModel ?? undefined,
      });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        sideJobModel: sideJobModel ?? undefined,
      });
    return null;
  },
});

const DEFAULT_CACHE_BREAK_CONFIRM = 100_000; // $0.10

// The soft daily budget; null removes it. At 100% sending stops until the owner's next day,
// unless overridden for today.
export const setDailyBudget = mutation({
  args: { microUsd: v.union(v.null(), v.number()) },
  returns: v.null(),
  handler: async (ctx, { microUsd }) => {
    const ownerId = await requireOwner(ctx);
    if (microUsd !== null && (!Number.isFinite(microUsd) || microUsd <= 0)) {
      throw new ConvexError("Enter a budget above $0, or clear it for none");
    }
    const dailyBudgetMicroUsd =
      microUsd === null ? undefined : Math.round(microUsd);
    const settings = await settingsFor(ctx, ownerId);
    if (settings)
      await ctx.db.patch("settings", settings._id, { dailyBudgetMicroUsd });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        dailyBudgetMicroUsd,
      });
    return null;
  },
});

// Lets sending continue past the budget for the rest of the owner's day.
export const overrideBudgetToday = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const settings = await settingsFor(ctx, ownerId);
    const budgetOverrideDay = dayIn(Date.now(), settings?.timeZone);
    if (settings)
      await ctx.db.patch("settings", settings._id, { budgetOverrideDay });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        budgetOverrideDay,
      });
    return null;
  },
});

// Editing a past message asks for confirmation when its cache break costs more than this.
export const setCacheBreakConfirm = mutation({
  args: { microUsd: v.number() },
  returns: v.null(),
  handler: async (ctx, { microUsd }) => {
    const ownerId = await requireOwner(ctx);
    if (!Number.isFinite(microUsd) || microUsd < 0)
      throw new ConvexError("Enter an amount of $0 or more");
    const cacheBreakConfirmMicroUsd = Math.round(microUsd);
    const settings = await settingsFor(ctx, ownerId);
    if (settings)
      await ctx.db.patch("settings", settings._id, {
        cacheBreakConfirmMicroUsd,
      });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        cacheBreakConfirmMicroUsd,
      });
    return null;
  },
});

// Off: pending keepalives stop at their next firing and threads use the 1-hour cache
// lifetime from their second turn on. On again: keepalive resumes after the next reply.
export const setKeepaliveEnabled = mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    const ownerId = await requireOwner(ctx);
    const settings = await settingsFor(ctx, ownerId);
    if (settings)
      await ctx.db.patch("settings", settings._id, {
        keepaliveEnabled: enabled,
      });
    else
      await ctx.db.insert("settings", {
        ownerId,
        allowlistedHosts: [],
        keepaliveEnabled: enabled,
      });
    return null;
  },
});

async function setHosts(
  ctx: MutationCtx,
  update: (hosts: string[]) => string[],
) {
  const ownerId = await requireOwner(ctx);
  const settings = await settingsFor(ctx, ownerId);
  const allowlistedHosts = update(settings?.allowlistedHosts ?? []);
  if (settings)
    await ctx.db.patch("settings", settings._id, { allowlistedHosts });
  else await ctx.db.insert("settings", { ownerId, allowlistedHosts });
}

export const addAllowedHost = mutation({
  args: { host: v.string() },
  returns: v.null(),
  handler: async (ctx, { host }) => {
    const normalized = normalizeHost(host);
    await setHosts(ctx, (hosts) =>
      hosts.includes(normalized) ? hosts : [...hosts, normalized],
    );
    return null;
  },
});

export const removeAllowedHost = mutation({
  args: { host: v.string() },
  returns: v.null(),
  handler: async (ctx, { host }) => {
    await setHosts(ctx, (hosts) => hosts.filter((h) => h !== host));
    return null;
  },
});

export const allowlist = internalQuery({
  args: { ownerId: v.id("users") },
  returns: v.array(v.string()),
  handler: async (ctx, { ownerId }) =>
    (await settingsFor(ctx, ownerId))?.allowlistedHosts ?? [],
});
