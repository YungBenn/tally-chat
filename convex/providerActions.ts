"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { fetchAnthropicModels } from "./lib/anthropic";
import { fetchOpenAICompatibleModels } from "./lib/openaiCompatible";
import type { GuardOptions } from "./lib/urlGuard";
import { encryptSecret } from "./lib/vault";
import { requireOwner } from "./owner";

// Node runtime for real DNS: the URL guard checks every address a host resolves to.
const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

async function guardFor(ctx: ActionCtx, ownerId: Id<"users">): Promise<GuardOptions> {
  const allowlist: string[] = await ctx.runQuery(internal.settings.allowlist, { ownerId });
  return { allowlist, resolve: systemResolve };
}

type ApiStyle = "anthropic" | "openai-compatible";
const apiStyleValidator = v.union(v.literal("anthropic"), v.literal("openai-compatible"));

// Anthropic paths start with /v1/, so its base drops a trailing /v1; OpenAI-compatible
// bases conventionally include it (https://api.openai.com/v1, http://host:11434/v1).
function normalizeBaseUrl(input: string, apiStyle: ApiStyle): string {
  let url: string;
  try {
    url = new URL(input.trim()).href.replace(/\/+$/, "");
  } catch {
    throw new ConvexError("Base URL is not a valid URL");
  }
  return apiStyle === "anthropic" ? url.replace(/\/v1$/, "") : url;
}

const fetchModels = (apiStyle: ApiStyle, baseUrl: string, apiKey: string, guard: GuardOptions) =>
  apiStyle === "anthropic" ? fetchAnthropicModels(baseUrl, apiKey, guard) : fetchOpenAICompatibleModels(baseUrl, apiKey, guard);

export const add = action({
  args: { name: v.string(), apiStyle: apiStyleValidator, baseUrl: v.string(), apiKey: v.string(), free: v.optional(v.boolean()) },
  returns: v.id("providers"),
  handler: async (ctx, args): Promise<Id<"providers">> => {
    const ownerId = await requireOwner(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError("Name is required");
    const baseUrl = normalizeBaseUrl(args.baseUrl, args.apiStyle);
    const apiKey = args.apiKey.trim();
    if (!apiKey && args.apiStyle === "anthropic") throw new ConvexError("API key is required");
    const { detected, models } = await fetchModels(args.apiStyle, baseUrl, apiKey, await guardFor(ctx, ownerId));
    return ctx.runMutation(internal.providers.insert, {
      ownerId, name, apiStyle: args.apiStyle, baseUrl, detected, models, free: args.free ?? false,
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
    const { detected } = await fetchModels(provider.apiStyle, provider.baseUrl, apiKey.trim(), await guardFor(ctx, ownerId));
    await ctx.runMutation(internal.providers.patchKey, {
      providerId, detected, apiKeyEncrypted: await encryptSecret(apiKey.trim()), keyCheckedAt: Date.now(),
    });
    return null;
  },
});
