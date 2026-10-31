import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { fetchAnthropicModels } from "./lib/anthropic";
import { encryptSecret } from "./lib/vault";
import { requireOwner } from "./owner";

const providerView = v.object({
  _id: v.id("providers"),
  name: v.string(),
  apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
  baseUrl: v.string(),
  detected: v.string(),
  keyCheckedAt: v.number(),
  models: v.array(v.object({ id: v.string(), displayName: v.string(), hidden: v.boolean() })),
});

// The only shape a provider leaves the server in: everything except the key.
const toView = ({ _id, name, apiStyle, baseUrl, detected, keyCheckedAt, models }: Doc<"providers">) => ({
  _id, name, apiStyle, baseUrl, detected, keyCheckedAt, models,
});

// https only for now; the full SSRF guard arrives in ticket 04.
function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ConvexError("Base URL is not a valid URL");
  }
  if (url.protocol !== "https:") throw new ConvexError("Base URL must use https");
  return url.href.replace(/\/+$/, "").replace(/\/v1$/, "");
}

export const list = query({
  args: {},
  returns: v.array(providerView),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query("providers").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).take(100);
    return rows.map(toView);
  },
});

export const add = action({
  args: { name: v.string(), apiStyle: v.literal("anthropic"), baseUrl: v.string(), apiKey: v.string() },
  returns: v.id("providers"),
  handler: async (ctx, args): Promise<Id<"providers">> => {
    const ownerId = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Name is required");
    const baseUrl = normalizeBaseUrl(args.baseUrl);
    const { detected, models } = await fetchAnthropicModels(baseUrl, args.apiKey.trim());
    return ctx.runMutation(internal.providers.insert, {
      ownerId, name, apiStyle: args.apiStyle, baseUrl, detected, models,
      apiKeyEncrypted: await encryptSecret(args.apiKey.trim()),
      keyCheckedAt: Date.now(),
    });
  },
});

export const replaceKey = action({
  args: { providerId: v.id("providers"), apiKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { providerId, apiKey }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.runQuery(internal.providers.getOwned, { ownerId, providerId });
    const { detected } = await fetchAnthropicModels(provider.baseUrl, apiKey.trim());
    await ctx.runMutation(internal.providers.patchKey, {
      providerId, detected, apiKeyEncrypted: await encryptSecret(apiKey.trim()), keyCheckedAt: Date.now(),
    });
    return null;
  },
});

export const updateModel = mutation({
  args: { providerId: v.id("providers"), modelId: v.string(), hidden: v.optional(v.boolean()), displayName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { providerId, modelId, hidden, displayName }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId) throw new ConvexError("Provider not found");
    const models = provider.models.map((m) =>
      m.id !== modelId ? m : { ...m, hidden: hidden ?? m.hidden, displayName: displayName?.trim() || m.displayName },
    );
    await ctx.db.patch("providers", providerId, { models });
    return null;
  },
});

export const remove = mutation({
  args: { providerId: v.id("providers") },
  returns: v.null(),
  handler: async (ctx, { providerId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId) throw new ConvexError("Provider not found");
    await ctx.db.delete("providers", providerId);
    return null;
  },
});

const modelValidator = v.object({ id: v.string(), displayName: v.string(), hidden: v.boolean() });

export const insert = internalMutation({
  args: {
    ownerId: v.id("users"), name: v.string(), apiStyle: v.literal("anthropic"), baseUrl: v.string(),
    apiKeyEncrypted: v.string(), detected: v.string(), keyCheckedAt: v.number(), models: v.array(modelValidator),
  },
  returns: v.id("providers"),
  handler: (ctx, args) => ctx.db.insert("providers", args),
});

export const getOwned = internalQuery({
  args: { ownerId: v.id("users"), providerId: v.id("providers") },
  returns: v.object({ baseUrl: v.string() }),
  handler: async (ctx, { ownerId, providerId }) => {
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId) throw new ConvexError("Provider not found");
    return { baseUrl: provider.baseUrl };
  },
});

export const patchKey = internalMutation({
  args: { providerId: v.id("providers"), apiKeyEncrypted: v.string(), detected: v.string(), keyCheckedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { providerId, ...fields }) => {
    await ctx.db.patch("providers", providerId, fields);
    return null;
  },
});
