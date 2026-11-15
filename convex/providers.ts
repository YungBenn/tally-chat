import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireOwner } from "./owner";

const providerView = v.object({
  _id: v.id("providers"),
  name: v.string(),
  apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
  baseUrl: v.string(),
  detected: v.string(),
  keyCheckedAt: v.number(),
  free: v.boolean(),
  models: v.array(
    v.object({
      id: v.string(),
      displayName: v.string(),
      hidden: v.boolean(),
      vision: v.optional(v.boolean()),
    }),
  ),
});

// The only shape a provider leaves the server in: everything except the key.
const toView = ({
  _id,
  name,
  apiStyle,
  baseUrl,
  detected,
  keyCheckedAt,
  free,
  models,
}: Doc<"providers">) => ({
  _id,
  name,
  apiStyle,
  baseUrl,
  detected,
  keyCheckedAt,
  free: free ?? false,
  models,
});

export const list = query({
  args: {},
  returns: v.array(providerView),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db
      .query("providers")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .take(100);
    return rows.map(toView);
  },
});

export const updateModel = mutation({
  args: {
    providerId: v.id("providers"),
    modelId: v.string(),
    hidden: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    vision: v.optional(v.boolean()), // "accepts images", set by the owner for OpenAI-compatible models
  },
  returns: v.null(),
  handler: async (
    ctx,
    { providerId, modelId, hidden, displayName, vision },
  ) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    const models = provider.models.map((m) =>
      m.id !== modelId
        ? m
        : {
            ...m,
            hidden: hidden ?? m.hidden,
            displayName: displayName?.trim() || m.displayName,
            vision: vision ?? m.vision,
          },
    );
    await ctx.db.patch("providers", providerId, { models });
    return null;
  },
});

// Whether calls through this provider cost nothing (local models). Changing it applies to calls
// from now on; recorded costs stay as they were.
export const setFree = mutation({
  args: { providerId: v.id("providers"), free: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { providerId, free }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    await ctx.db.patch("providers", providerId, { free });
    return null;
  },
});

export const remove = mutation({
  args: { providerId: v.id("providers") },
  returns: v.null(),
  handler: async (ctx, { providerId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    await ctx.db.delete("providers", providerId);
    return null;
  },
});

const modelValidator = v.object({
  id: v.string(),
  displayName: v.string(),
  hidden: v.boolean(),
  vision: v.optional(v.boolean()),
});

// A refreshed model list: new models are added, known ones keep the owner's name and hidden
// flag, and image support comes from the provider. Models the provider no longer lists are dropped.
export const mergeModels = internalMutation({
  args: { providerId: v.id("providers"), models: v.array(modelValidator) },
  returns: v.null(),
  handler: async (ctx, { providerId, models }) => {
    const provider = await ctx.db.get("providers", providerId);
    if (!provider) return null;
    const known = new Map(provider.models.map((m) => [m.id, m]));
    await ctx.db.patch("providers", providerId, {
      models: models.map((m) => {
        const before = known.get(m.id);
        // OpenAI-compatible lists report no image support, so the owner's toggle stays.
        return before
          ? {
              ...m,
              displayName: before.displayName,
              hidden: before.hidden,
              vision: m.vision ?? before.vision,
            }
          : m;
      }),
    });
    return null;
  },
});

export const insert = internalMutation({
  args: {
    ownerId: v.id("users"),
    name: v.string(),
    apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
    baseUrl: v.string(),
    free: v.boolean(),
    apiKeyEncrypted: v.string(),
    detected: v.string(),
    keyCheckedAt: v.number(),
    models: v.array(modelValidator),
  },
  returns: v.id("providers"),
  handler: (ctx, args) => ctx.db.insert("providers", args),
});

export const getOwned = internalQuery({
  args: { ownerId: v.id("users"), providerId: v.id("providers") },
  returns: v.object({
    apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
    baseUrl: v.string(),
    apiKeyEncrypted: v.string(), // internal only: actions decrypt it to call the provider
  }),
  handler: async (ctx, { ownerId, providerId }) => {
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    return {
      apiStyle: provider.apiStyle,
      baseUrl: provider.baseUrl,
      apiKeyEncrypted: provider.apiKeyEncrypted,
    };
  },
});

export const patchKey = internalMutation({
  args: {
    providerId: v.id("providers"),
    apiKeyEncrypted: v.string(),
    detected: v.string(),
    keyCheckedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { providerId, ...fields }) => {
    await ctx.db.patch("providers", providerId, fields);
    return null;
  },
});
