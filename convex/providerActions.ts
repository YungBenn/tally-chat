"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { fetchAnthropicModels } from "./lib/anthropic";
import type { GuardOptions } from "./lib/urlGuard";
import { encryptSecret } from "./lib/vault";
import { requireOwner } from "./owner";

// Node runtime for real DNS: the URL guard checks every address a host resolves to.
const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

async function guardFor(ctx: ActionCtx, ownerId: Id<"users">): Promise<GuardOptions> {
  const allowlist: string[] = await ctx.runQuery(internal.settings.allowlist, { ownerId });
  return { allowlist, resolve: systemResolve };
}

function normalizeBaseUrl(input: string): string {
  try {
    return new URL(input.trim()).href.replace(/\/+$/, "").replace(/\/v1$/, "");
  } catch {
    throw new ConvexError("Base URL is not a valid URL");
  }
}

export const add = action({
  args: { name: v.string(), apiStyle: v.literal("anthropic"), baseUrl: v.string(), apiKey: v.string() },
  returns: v.id("providers"),
  handler: async (ctx, args): Promise<Id<"providers">> => {
    const ownerId = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Name is required");
    const baseUrl = normalizeBaseUrl(args.baseUrl);
    const apiKey = args.apiKey.trim();
    const { detected, models } = await fetchAnthropicModels(baseUrl, apiKey, await guardFor(ctx, ownerId));
    return ctx.runMutation(internal.providers.insert, {
      ownerId, name, apiStyle: args.apiStyle, baseUrl, detected, models,
      apiKeyEncrypted: await encryptSecret(apiKey),
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
    const { detected } = await fetchAnthropicModels(provider.baseUrl, apiKey.trim(), await guardFor(ctx, ownerId));
    await ctx.runMutation(internal.providers.patchKey, {
      providerId, detected, apiKeyEncrypted: await encryptSecret(apiKey.trim()), keyCheckedAt: Date.now(),
    });
    return null;
  },
});
