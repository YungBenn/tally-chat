"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import type { ChatMessage } from "./lib/anthropic";
import {
  sendAnthropicKeepalive,
  streamAnthropicMessage,
} from "./lib/anthropic";
import type { CacheTtl } from "./lib/cacheStatus";
import {
  CURRENT_SUMMARY_PROMPT_VERSION,
  SUMMARY_MAX_TOKENS,
  SUMMARY_PROMPTS,
} from "./lib/condense";
import { callMcpTool } from "./lib/mcp";
import { streamOpenAICompatible } from "./lib/openaiCompatible";
import { RESULT_NOTE, type ToolStatus } from "./lib/toolParts";
import type { NormalizedUsage } from "./lib/usage";
import { decryptSecret } from "./lib/vault";
import { searchExa, type StoredSearch } from "./lib/webSearch";

const FLUSH_MS = 100;

// Every failure becomes the search's error, so the reply still runs and says why.
async function runSearch(
  query: string,
  keyEncrypted: string | null,
): Promise<StoredSearch> {
  if (!keyEncrypted) return { query, results: [], error: "web search is off" };
  let apiKey: string;
  try {
    apiKey = await decryptSecret(keyEncrypted);
  } catch (err) {
    return {
      query,
      results: [],
      // A ConvexError is the key mismatch; anything else (a bad master key) keeps its reason.
      error:
        err instanceof ConvexError
          ? "the Exa API key can't be decrypted: TALLY_MASTER_KEY isn't the key it was saved with; paste it again in Settings"
          : err instanceof Error
            ? err.message
            : String(err),
    };
  }
  return searchExa(apiKey, query);
}
// Loads each user message's stored images as base64 for the request (spec phase 4). The stored
// bytes never change, so a retry or keepalive sends identical blocks.
async function loadImages(
  ctx: ActionCtx,
  history: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    history.map(async (m) => {
      if (!m.images?.length) return m;
      const imageData = await Promise.all(
        m.images.map(async (image) => {
          const blob = await ctx.storage.get(image.storageId);
          if (!blob)
            throw new ConvexError("An image in this thread is missing");
          return {
            mediaType: image.mediaType,
            data: Buffer.from(await blob.arrayBuffer()).toString("base64"),
          };
        }),
      );
      return { ...m, imageData };
    }),
  );
}

const systemResolve = async (host: string) =>
  (await lookup(host, { all: true })).map((a) => a.address);

// One step of a reply (spec phase 10): a single model request. A step that asks for tools ends
// in chat.finalize, which schedules runTools; its results schedule the next step. A reply with
// no tool calls is exactly one step.
export const generate = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    // Reply timing log (spec phase 12): one line per step, times from the action's start.
    const startedAt = Date.now();
    // Web search first (lib/webSearch): the reply's request carries the stored results.
    const search = await ctx.runQuery(internal.webSearch.pending, {
      replyId: messageId,
    });
    if (search)
      await ctx.runMutation(internal.webSearch.save, {
        messageId: search.messageId,
        ownerId: search.ownerId,
        threadId: search.threadId,
        ...(await runSearch(search.query, search.keyEncrypted)),
      });
    const inputStart = Date.now();
    const input = await ctx.runQuery(internal.chat.generationInput, {
      messageId,
    });
    const inputMs = Date.now() - inputStart;
    let firstEventAt: number | undefined;
    let firstTextAt: number | undefined;
    const since = (at?: number) =>
      at === undefined ? "-" : `${at - startedAt}ms`;
    const logTiming = (status: string) =>
      console.log(
        `reply step ${messageId} status=${status} queue=${input ? `${Math.round(startedAt - input.queuedAt)}ms` : "-"} input=${inputMs}ms firstEvent=${since(firstEventAt)} firstText=${since(firstTextAt)} total=${since(Date.now())}`,
      );
    if (!input) {
      // Thread deleted before we started: close the reply so the purge can remove it.
      await ctx.runMutation(internal.chat.finalize, {
        messageId,
        status: "stopped",
        content: "",
      });
      logTiming("stopped");
      return null;
    }
    let full = "";
    let pending = ""; // text not yet flushed to the stream row
    // ponytail: a stopped reply only has usage up to the last message_delta, so output
    // tokens generated after it are billed by the provider but not recorded here.
    let usage: NormalizedUsage | undefined;
    // Set when the request carried cache breakpoints: the cache lifetime counts from its start.
    let cacheRequest: { startedAt: number; ttl: CacheTtl } | undefined;
    let truncated = false;
    // What the model asked for in this step, and the thinking it must get back with the results.
    const toolCalls: { id: string; name: string; input: string }[] = [];
    const thinking: (
      | { type: "thinking"; thinking: string; signature: string }
      | { type: "redactedThinking"; data: string }
    )[] = [];
    const finish = async (
      status: "done" | "stopped" | "error",
      error?: string,
    ) => {
      await ctx.runMutation(internal.chat.finalize, {
        messageId,
        status,
        content: full,
        error,
        cacheRequest,
        truncated: truncated || undefined,
        thinking,
        toolCalls,
        ...usage,
      });
      if (full && firstTextAt === undefined) firstTextAt = Date.now();
      logTiming(status);
    };

    const abort = new AbortController();
    try {
      if (!input.provider)
        throw new ConvexError("This thread's provider was deleted");
      const anthropic = input.provider.apiStyle === "anthropic";
      const stream = anthropic
        ? streamAnthropicMessage
        : streamOpenAICompatible;
      const ttl = input.cacheTtl;
      if (anthropic) cacheRequest = { startedAt: Date.now(), ttl };
      if (input.stopRequested) {
        await finish("stopped");
        return null;
      }
      const deltas = stream(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: input.system,
          messages: await loadImages(ctx, input.history),
          maxTokens: input.maxTokens,
          effort: input.effort,
          tools: input.tools,
          cache: { ttl, layerEnd: input.layerEnd },
        },
        { allowlist: input.allowlist, resolve: systemResolve },
        abort.signal,
      );
      let lastFlush = Date.now();
      for await (const event of deltas) {
        firstEventAt ??= Date.now();
        if (event.type === "usage") {
          usage = {
            usage: event.usage,
            reports: event.reports,
            reportedCostMicroUsd: event.reportedCostMicroUsd,
          };
          continue;
        }
        if (event.type === "stop") {
          truncated = event.truncated;
          continue;
        }
        if (event.type === "toolCall") {
          toolCalls.push({
            id: event.id,
            name: event.name,
            input: JSON.stringify(event.input ?? {}),
          });
          continue;
        }
        if (event.type === "thinking" || event.type === "redactedThinking") {
          thinking.push(event);
          continue;
        }
        const text = event.text;
        full += text;
        pending += text;
        if (Date.now() - lastFlush < FLUSH_MS) continue;
        const stop = await ctx.runMutation(internal.chat.flush, { messageId, text: pending });
        firstTextAt ??= Date.now();
        pending = "";
        lastFlush = Date.now();
        if (stop) {
          abort.abort();
          await finish("stopped");
          return null;
        }
      }
      await finish("done");
    } catch (err) {
      if (!(err instanceof ConvexError)) console.error("reply failed:", err);
      toolCalls.length = 0;
      await finish(
        "error",
        err instanceof ConvexError
          ? String(err.data)
          : "Could not reach the provider",
      );
    }
    return null;
  },
});

// Runs the tool calls a step asked for, in parallel (spec phase 10). Every outcome, including a
// timeout, an unreachable server or a tool the server no longer offers, becomes a result the
// model sees; nothing here fails the reply. Calls the owner declined (or that were never
// approved) tell the model so.
export const runTools = internalAction({
  args: {
    messageId: v.id("messages"),
    step: v.number(),
    declined: v.array(v.string()), // calls the owner declined
  },
  returns: v.null(),
  handler: async (ctx, { messageId, step, declined }) => {
    const input = await ctx.runQuery(internal.chat.toolRunInput, { messageId, step });
    if (!input) return null; // the reply was closed meanwhile
    const stopped = new AbortController();
    // Stop reaches a call in flight: polled, since nothing pushes to an action.
    const watch = setInterval(() => {
      void ctx
        .runQuery(internal.chat.stopRequested, { messageId })
        .then((stop) => stop && stopped.abort());
    }, 1000);
    const guard = { allowlist: input.allowlist, resolve: systemResolve };
    const results = await Promise.all(
      input.calls.map(async (call): Promise<{ id: string; text: string; status: ToolStatus }> => {
        const fail = (text: string) => ({ id: call.id, text: `Error: ${text}`, status: "error" as const });
        if (declined.includes(call.id)) return { id: call.id, text: RESULT_NOTE.declined, status: "declined" };
        if (call.problem) return fail(call.problem);
        try {
          const headers = call.headersEncrypted
            ? (JSON.parse(await decryptSecret(call.headersEncrypted)) as Record<string, string>)
            : {};
          const args = JSON.parse(call.input) as Record<string, unknown>;
          const result = await callMcpTool(call.url!, headers, guard, call.tool!, args, stopped.signal);
          if (result.status === "timedOut") return { id: call.id, text: RESULT_NOTE.timedOut, status: "timedOut" };
          return result.status === "error"
            ? fail(result.text || "the tool failed")
            : { id: call.id, text: result.text, status: "ok" };
        } catch {
          return fail("the tool call could not be made");
        }
      }),
    ).finally(() => clearInterval(watch));
    await ctx.runMutation(internal.chat.finishTools, { messageId, step, results });
    return null;
  },
});

const TITLE_SYSTEM =
  "Write a title of at most six words for this conversation. Reply with the title only, no quotes.";
const TITLE_EXCERPT = 2000; // characters of each message sent to the title model

// Side job: titles a thread from its first exchange. Any failure leaves the fallback title
// (the first message) in place and never touches the chat itself.
export const generateTitle = internalAction({
  args: { threadId: v.id("threads"), replyId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { threadId, replyId }) => {
    const input = await ctx.runQuery(internal.chat.titleJobInput, {
      threadId,
      replyId,
      now: Date.now(),
    });
    if (!input) return null;
    let text = "";
    let usage: NormalizedUsage | undefined;
    try {
      const stream =
        input.provider.apiStyle === "anthropic"
          ? streamAnthropicMessage
          : streamOpenAICompatible;
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
          effort: input.provider.apiStyle === "anthropic" ? "low" : undefined, // titles need no deep thought
        },
        { allowlist: input.allowlist, resolve: systemResolve },
        new AbortController().signal,
      );
      for await (const event of events) {
        if (event.type === "text") text += event.text;
        else if (event.type === "usage")
          usage = {
            usage: event.usage,
            reports: event.reports,
            reportedCostMicroUsd: event.reportedCostMicroUsd,
          };
      }
    } catch {
      text = ""; // keep the fallback title; still bill whatever usage arrived
    }
    const title = text
      .trim()
      .replace(/^["'\s]+|["'.\s]+$/g, "")
      .slice(0, 60);
    await ctx.runMutation(internal.chat.saveTitle, {
      threadId,
      providerId: input.providerId,
      model: input.model,
      title: title || undefined,
      ...usage,
    });
    return null;
  },
});

// Condense job (spec phase 6): summarizes the turns condense.input picked on the thread's own model
// and saves the summary as a checkpoint. A failed, empty or cut-off summary saves nothing; the
// next reply tries again.
export const condense = internalAction({
  args: { threadId: v.id("threads"), force: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { threadId, force }) => {
    const input = await ctx.runQuery(internal.condense.input, {
      threadId,
      now: Date.now(),
      force,
    });
    if (!input) return null;
    let text = "";
    let truncated = false;
    let failure: string | undefined;
    let usage: NormalizedUsage | undefined;
    try {
      const stream =
        input.provider.apiStyle === "anthropic"
          ? streamAnthropicMessage
          : streamOpenAICompatible;
      const events = stream(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: SUMMARY_PROMPTS[CURRENT_SUMMARY_PROMPT_VERSION],
          messages: [{ role: "user", content: input.request }],
          maxTokens: SUMMARY_MAX_TOKENS,
        },
        { allowlist: input.allowlist, resolve: systemResolve },
        new AbortController().signal,
      );
      for await (const event of events) {
        if (event.type === "text") text += event.text;
        else if (event.type === "stop") truncated = event.truncated;
        else if (event.type === "usage")
          usage = {
            usage: event.usage,
            reports: event.reports,
            reportedCostMicroUsd: event.reportedCostMicroUsd,
          };
      }
    } catch (err) {
      failure =
        err instanceof ConvexError
          ? String(err.data)
          : "Could not reach the provider";
    }
    const summary = text.trim();
    if (!failure && truncated) failure = "the summary was cut off";
    if (!failure && !summary) failure = "the summary came back empty";
    await ctx.runMutation(internal.condense.save, {
      threadId,
      coversUpToId: input.coversUpToId,
      providerId: input.providerId,
      model: input.model,
      promptVersion: CURRENT_SUMMARY_PROMPT_VERSION,
      summary: failure ? undefined : summary,
      failure,
      ...usage,
    });
    return null;
  },
});

// Keepalive job (spec phase 2): re-sends the thread's cached prefix through its latest reply
// (see sendAnthropicKeepalive) with max_tokens 0, so the cache stays warm while the owner is in the thread. Runs only when
// keepalive.input says it can help; any failure just ends the cycle until the next reply.
export const keepalive = internalAction({
  args: { threadId: v.id("threads"), warm: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { threadId, warm }) => {
    const startedAt = Date.now();
    const input = await ctx.runQuery(internal.keepalive.input, {
      threadId,
      now: startedAt,
      warm,
    });
    if (!input) return null;
    let usage: NormalizedUsage | undefined;
    try {
      usage = await sendAnthropicKeepalive(
        {
          baseUrl: input.provider.baseUrl,
          apiKey: await decryptSecret(input.provider.apiKeyEncrypted),
          model: input.model,
          system: input.system,
          messages: await loadImages(ctx, input.history),
          effort: input.effort,
          tools: input.tools,
          cache: { ttl: input.ttl, layerEnd: input.layerEnd },
        },
        { allowlist: input.allowlist, resolve: systemResolve },
      );
    } catch {
      // usage stays undefined: a failed non-streaming call reports none
    }
    await ctx.runMutation(internal.keepalive.record, {
      threadId,
      providerId: input.providerId,
      model: input.model,
      startedAt,
      ttl: input.ttl,
      sent: usage !== undefined,
      ...usage,
    });
    return null;
  },
});
