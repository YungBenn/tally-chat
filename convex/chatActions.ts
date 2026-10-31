"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { streamAnthropicMessage } from "./lib/anthropic";
import { streamOpenAICompatible } from "./lib/openaiCompatible";
import { SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { appendChunk } from "./lib/textStream";
import type { NormalizedUsage } from "./lib/usage";
import { decryptSecret } from "./lib/vault";

const FLUSH_MS = 100;
const MAX_TOKENS = 4096; // ponytail: fixed until output modes land (S11, phase 4)
const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

export const generate = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const input = await ctx.runQuery(internal.chat.generationInput, { messageId });
    if (!input) return null;
    let full = "";
    let pending = "";
    // ponytail: a stopped reply only has usage up to the last message_delta, so output
    // tokens generated after it are billed by the provider but not recorded here.
    let usage: NormalizedUsage | undefined;
    const finish = (status: "done" | "stopped" | "error", error?: string) =>
      ctx.runMutation(internal.chat.finalize, {
        messageId, status, content: full, pending, error,
        ...usage,
      });

    const abort = new AbortController();
    try {
      if (!input.provider) throw new ConvexError("This thread's provider was deleted");
      const stream = input.provider.apiStyle === "anthropic" ? streamAnthropicMessage : streamOpenAICompatible;
      const deltas = stream(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: SYSTEM_PROMPTS[input.systemPromptVersion],
          messages: input.history,
          maxTokens: MAX_TOKENS,
        },
        { allowlist: input.allowlist, resolve: systemResolve },
        abort.signal,
      );
      let lastFlush = Date.now();
      for await (const event of deltas) {
        if (event.type === "usage") {
          usage = { usage: event.usage, reports: event.reports, reportedCostMicroUsd: event.reportedCostMicroUsd };
          continue;
        }
        const text = event.text;
        full += text;
        pending += text;
        if (Date.now() - lastFlush < FLUSH_MS) continue;
        await appendChunk(ctx, input.streamId, pending, false);
        pending = "";
        lastFlush = Date.now();
        if (await ctx.runQuery(internal.chat.stopRequested, { messageId })) {
          abort.abort();
          await finish("stopped");
          return null;
        }
      }
      await finish("done");
    } catch (err) {
      await finish("error", err instanceof ConvexError ? String(err.data) : "Could not reach the provider");
    }
    return null;
  },
});
