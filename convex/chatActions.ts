"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { sendAnthropicKeepalive, streamAnthropicMessage } from "./lib/anthropic";
import type { CacheTtl } from "./lib/cacheStatus";
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
    if (!input) {
      // Thread deleted before we started: close the reply so the purge can remove it.
      await ctx.runMutation(internal.chat.finalize, { messageId, status: "stopped", content: "", pending: "" });
      return null;
    }
    let full = "";
    let pending = "";
    // ponytail: a stopped reply only has usage up to the last message_delta, so output
    // tokens generated after it are billed by the provider but not recorded here.
    let usage: NormalizedUsage | undefined;
    // Set when the request carried cache breakpoints: the cache lifetime counts from its start.
    let cacheRequest: { startedAt: number; ttl: CacheTtl } | undefined;
    const finish = (status: "done" | "stopped" | "error", error?: string) =>
      ctx.runMutation(internal.chat.finalize, {
        messageId, status, content: full, pending, error, cacheRequest,
        ...usage,
      });

    const abort = new AbortController();
    try {
      if (!input.provider) throw new ConvexError("This thread's provider was deleted");
      const anthropic = input.provider.apiStyle === "anthropic";
      const stream = anthropic ? streamAnthropicMessage : streamOpenAICompatible;
      const ttl = input.cacheTtl;
      if (anthropic) cacheRequest = { startedAt: Date.now(), ttl };
      const deltas = stream(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: SYSTEM_PROMPTS[input.systemPromptVersion],
          messages: input.history,
          maxTokens: MAX_TOKENS,
          cache: { ttl, layerEnd: input.layerEnd },
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

const TITLE_SYSTEM = "Write a title of at most six words for this conversation. Reply with the title only, no quotes.";
const TITLE_EXCERPT = 2000; // characters of each message sent to the title model

// Side job: titles a thread from its first exchange. Any failure leaves the fallback title
// (the first message) in place and never touches the chat itself.
export const generateTitle = internalAction({
  args: { threadId: v.id("threads"), replyId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { threadId, replyId }) => {
    const input = await ctx.runQuery(internal.chat.titleJobInput, { threadId, replyId });
    if (!input) return null;
    let text = "";
    let usage: NormalizedUsage | undefined;
    try {
      const stream = input.provider.apiStyle === "anthropic" ? streamAnthropicMessage : streamOpenAICompatible;
      const events = stream(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: TITLE_SYSTEM,
          messages: [
            {
              role: "user",
              content: `User: ${input.question.slice(0, TITLE_EXCERPT)}\n\nAssistant: ${input.answer.slice(0, TITLE_EXCERPT)}`,
            },
          ],
          maxTokens: 30,
        },
        { allowlist: input.allowlist, resolve: systemResolve },
        new AbortController().signal,
      );
      for await (const event of events) {
        if (event.type === "text") text += event.text;
        else usage = { usage: event.usage, reports: event.reports, reportedCostMicroUsd: event.reportedCostMicroUsd };
      }
    } catch {
      text = ""; // keep the fallback title; still bill whatever usage arrived
    }
    const title = text.trim().replace(/^["'\s]+|["'.\s]+$/g, "").slice(0, 60);
    await ctx.runMutation(internal.chat.saveTitle, {
      threadId, providerId: input.providerId, model: input.model, title: title || undefined, ...usage,
    });
    return null;
  },
});

// Keepalive job (spec phase 2): re-sends the thread's cached prefix through its latest reply
// (see sendAnthropicKeepalive) with max_tokens 0, so the cache stays warm while the owner is in the thread. Runs only when
// keepalive.input says it can help; any failure just ends the cycle until the next reply.
export const keepalive = internalAction({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const startedAt = Date.now();
    const input = await ctx.runQuery(internal.keepalive.input, { threadId, now: startedAt });
    if (!input) return null;
    let usage: NormalizedUsage | undefined;
    try {
      usage = await sendAnthropicKeepalive(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: SYSTEM_PROMPTS[input.systemPromptVersion],
          messages: input.history,
          cache: { ttl: input.ttl, layerEnd: input.layerEnd },
        },
        { allowlist: input.allowlist, resolve: systemResolve },
      );
    } catch {
      // usage stays undefined: a failed non-streaming call reports none
    }
    await ctx.runMutation(internal.keepalive.record, {
      threadId, providerId: input.providerId, model: input.model, startedAt, ttl: input.ttl, sent: usage !== undefined, ...usage,
    });
    return null;
  },
});
