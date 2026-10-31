import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

export const list = query({
  args: {},
  returns: v.array(providerView),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db.query("providers").withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId)).take(100);
    return rows.map(toView);
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
