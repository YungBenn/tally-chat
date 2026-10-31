import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { CURRENT_SYSTEM_PROMPT_VERSION } from "./lib/systemPrompts";
import { assembleHistory } from "./lib/context";
import { recordDailyUsage } from "./lib/rollups";
import { appendChunk, createStream, deleteStream, streamText } from "./lib/textStream";
import { costMicroUsd, priceFor, usageValidator } from "./lib/usage";
import { requireOwner } from "./owner";

async function ownedThread(ctx: QueryCtx, ownerId: Id<"users">, threadId: Id<"threads">) {
  const thread = await ctx.db.get("threads", threadId);
  if (!thread || thread.ownerId !== ownerId) throw new ConvexError("Thread not found");
  return thread;
}

// The active branch, root first: the leaf's ancestorIds plus the leaf, fetched in one batch.
async function activeBranch(ctx: QueryCtx, thread: Doc<"threads">): Promise<Doc<"messages">[]> {
  if (!thread.activeLeafId) return [];
  const leaf = await ctx.db.get("messages", thread.activeLeafId);
  if (!leaf) return [];
  const ancestors = await Promise.all(leaf.ancestorIds.map((id) => ctx.db.get("messages", id)));
  return [...ancestors.filter((m) => m !== null), leaf];
}

export const listThreads = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("threads"), title: v.string() })),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    return threads.map(({ _id, title }) => ({ _id, title }));
  },
});

export const createThread = mutation({
  args: { providerId: v.id("providers"), modelId: v.string() },
  returns: v.id("threads"),
  handler: async (ctx, { providerId, modelId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId) throw new ConvexError("Provider not found");
    if (!provider.models.some((m) => m.id === modelId && !m.hidden)) throw new ConvexError("Model not available");
    return ctx.db.insert("threads", {
      ownerId,
      title: "New thread",
      providerId,
      modelId,
      systemPromptVersion: CURRENT_SYSTEM_PROMPT_VERSION,
    });
  },
});

const messageView = v.object({
  _id: v.id("messages"),
  siblingIds: v.array(v.id("messages")), // this message's versions (itself included), oldest first
  role: v.union(v.literal("user"), v.literal("assistant")),
  status: v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("error")),
  text: v.string(),
  error: v.optional(v.string()),
  model: v.optional(v.string()),
  usage: v.optional(usageValidator),
  costMicroUsd: v.optional(v.number()),
});

// null when the thread doesn't exist (or was deleted), so a page left open on another
// device can say so instead of crashing.
export const getThread = query({
  args: { threadId: v.id("threads") },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      providerId: v.id("providers"),
      modelId: v.string(),
      messages: v.array(messageView),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    const branch = await activeBranch(ctx, thread);
    const messages = await Promise.all(
      branch.map(async (m) => ({
        _id: m._id,
        siblingIds: (
          await ctx.db
            .query("messages")
            .withIndex("by_thread_parent", (q) => q.eq("threadId", thread._id).eq("parentId", m.parentId))
            .take(100)
        ).map((s) => s._id),
        role: m.role,
        status: m.status,
        // A streaming reply reads its text from the stream, so a reload or a second
        // device sees what has arrived so far and keeps updating.
        text: m.status === "streaming" && m.streamId ? await streamText(ctx, m.streamId) : m.content,
        error: m.error,
        model: m.model,
        usage: m.usage,
        costMicroUsd: m.costMicroUsd,
      })),
    );
    return { title: thread.title, providerId: thread.providerId, modelId: thread.modelId, messages };
  },
});

async function assertNotStreaming(ctx: QueryCtx, thread: Doc<"threads">) {
  const leaf = thread.activeLeafId ? await ctx.db.get("messages", thread.activeLeafId) : null;
  if (leaf?.status === "streaming") throw new ConvexError("Wait for the reply to finish, or stop it");
}

function cleanText(content: string) {
  const text = content.trim();
  if (!text) throw new ConvexError("Message is empty");
  return text;
}

async function appendUserMessage(ctx: MutationCtx, thread: Doc<"threads">, parent: Doc<"messages"> | null, text: string) {
  const id = await ctx.db.insert("messages", {
    ownerId: thread.ownerId,
    threadId: thread._id,
    parentId: parent?._id,
    ancestorIds: parent ? [...parent.ancestorIds, parent._id] : [],
    role: "user",
    pinned: false,
    content: text,
    status: "done",
  });
  return (await ctx.db.get("messages", id))!;
}

// A new streaming reply under `user`, made the active leaf, with generation scheduled.
async function startReply(ctx: MutationCtx, thread: Doc<"threads">, user: Doc<"messages">) {
  const assistantId = await ctx.db.insert("messages", {
    ownerId: thread.ownerId,
    threadId: thread._id,
    parentId: user._id,
    ancestorIds: [...user.ancestorIds, user._id],
    role: "assistant",
    pinned: false,
    content: "",
    status: "streaming",
    streamId: await createStream(ctx),
    model: thread.modelId,
    providerId: thread.providerId,
  });
  // ponytail: first message as title until side-job titles land (ticket 11).
  const title = thread.activeLeafId ? thread.title : user.content.slice(0, 60);
  await ctx.db.patch("threads", thread._id, { activeLeafId: assistantId, title });
  await ctx.scheduler.runAfter(0, internal.chatActions.generate, { messageId: assistantId });
}

async function ownedMessage(ctx: QueryCtx, ownerId: Id<"users">, messageId: Id<"messages">) {
  const message = await ctx.db.get("messages", messageId);
  if (!message || message.ownerId !== ownerId) throw new ConvexError("Message not found");
  return message;
}

export const send = mutation({
  args: { threadId: v.id("threads"), content: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, content }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    const text = cleanText(content);
    await assertNotStreaming(ctx, thread);
    const parent = thread.activeLeafId ? await ctx.db.get("messages", thread.activeLeafId) : null;
    await startReply(ctx, thread, await appendUserMessage(ctx, thread, parent, text));
    return null;
  },
});

// A new reply beside an existing one, under the same user message (ADR 0001: nothing is overwritten).
export const retry = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    const reply = await ownedMessage(ctx, ownerId, messageId);
    if (reply.role !== "assistant" || !reply.parentId) throw new ConvexError("Only replies can be retried");
    const thread = await ownedThread(ctx, ownerId, reply.threadId);
    await assertNotStreaming(ctx, thread);
    await startReply(ctx, thread, (await ctx.db.get("messages", reply.parentId))!);
    return null;
  },
});

// Editing is a fork: a new user message beside the edited one, then a reply to it.
export const edit = mutation({
  args: { messageId: v.id("messages"), content: v.string() },
  returns: v.null(),
  handler: async (ctx, { messageId, content }) => {
    const ownerId = await requireOwner(ctx);
    const original = await ownedMessage(ctx, ownerId, messageId);
    if (original.role !== "user") throw new ConvexError("Only your messages can be edited");
    const thread = await ownedThread(ctx, ownerId, original.threadId);
    const text = cleanText(content);
    await assertNotStreaming(ctx, thread);
    const parent = original.parentId ? await ctx.db.get("messages", original.parentId) : null;
    await startReply(ctx, thread, await appendUserMessage(ctx, thread, parent, text));
    return null;
  },
});

// Makes `messageId`'s branch active, following its newest descendants down to a leaf.
export const switchBranch = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    let leaf = await ownedMessage(ctx, ownerId, messageId);
    for (;;) {
      const child = await ctx.db
        .query("messages")
        .withIndex("by_thread_parent", (q) => q.eq("threadId", leaf.threadId).eq("parentId", leaf._id))
        .order("desc")
        .first();
      if (!child) break;
      leaf = child;
    }
    await ctx.db.patch("threads", leaf.threadId, { activeLeafId: leaf._id });
    return null;
  },
});

// Hard delete of a whole thread (single messages are never deleted, ADR 0001). The thread
// row goes now, so it vanishes from every device; purgeThread removes the rest in batches.
// Daily rollups are separate rows and keep the thread's spend.
export const deleteThread = mutation({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    await ctx.db.delete("threads", thread._id);
    await ctx.scheduler.runAfter(0, internal.chat.purgeThread, { threadId });
    return null;
  },
});

const PURGE_BATCH = 100;
// ponytail: a reply whose action crashed stays "streaming" forever; after this long the
// purge stops waiting for it. A sweeper for stuck replies would fix the root cause.
const STUCK_STREAM_MS = 15 * 60 * 1000;

export const purgeThread = internalMutation({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread_parent", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    let waiting = false;
    for (const m of messages) {
      // A reply still streaming is stopped first and left until it finalizes, so the
      // tokens the provider already billed still reach the rollups.
      if (m.status === "streaming" && Date.now() - m._creationTime < STUCK_STREAM_MS) {
        if (!m.stopRequested) await ctx.db.patch("messages", m._id, { stopRequested: true });
        waiting = true;
        continue;
      }
      if (m.streamId) await deleteStream(ctx, m.streamId);
      await ctx.db.delete("messages", m._id);
    }
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const c of checkpoints) await ctx.db.delete("checkpoints", c._id);

    const more = messages.length === PURGE_BATCH || checkpoints.length === PURGE_BATCH;
    if (more || waiting) await ctx.scheduler.runAfter(waiting && !more ? 1000 : 0, internal.chat.purgeThread, { threadId });
    return null;
  },
});

export const stop = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.ownerId !== ownerId) throw new ConvexError("Message not found");
    if (message.status === "streaming") await ctx.db.patch("messages", messageId, { stopRequested: true });
    return null;
  },
});

// Everything the streaming action needs, including the encrypted key (internal only).
export const generationInput = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({
      streamId: v.string(),
      model: v.string(),
      systemPromptVersion: v.number(),
      provider: v.union(
        v.null(),
        v.object({
          apiStyle: v.union(v.literal("anthropic"), v.literal("openai-compatible")),
          baseUrl: v.string(),
          apiKeyEncrypted: v.string(),
        }),
      ),
      allowlist: v.array(v.string()),
      history: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
    }),
  ),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming" || !message.streamId) return null;
    const thread = await ctx.db.get("threads", message.threadId);
    if (!thread) return null; // deleted while queued; purgeThread stops and removes the reply
    const provider = await ctx.db.get("providers", thread.providerId);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
      .unique();
    return {
      streamId: message.streamId,
      model: thread.modelId,
      systemPromptVersion: thread.systemPromptVersion,
      provider: provider && { apiStyle: provider.apiStyle, baseUrl: provider.baseUrl, apiKeyEncrypted: provider.apiKeyEncrypted },
      allowlist: settings?.allowlistedHosts ?? [],
      history: await assembleHistory(ctx, message),
    };
  },
});

export const stopRequested = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, { messageId }) => (await ctx.db.get("messages", messageId))?.stopRequested === true,
});

// The single transition out of "streaming". Content is written here once and never again.
export const finalize = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(v.literal("done"), v.literal("stopped"), v.literal("error")),
    content: v.string(),
    pending: v.string(),
    error: v.optional(v.string()),
    usage: v.optional(usageValidator),
    reports: v.optional(v.object({ caching: v.boolean(), reasoning: v.boolean() })),
    reportedCostMicroUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, status, content, pending, error, usage, reports, reportedCostMicroUsd }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming") return null;
    if (message.streamId) await appendChunk(ctx, message.streamId, pending, true);
    if (!usage) {
      await ctx.db.patch("messages", messageId, { status, content, error });
      return null;
    }

    const model = message.model ?? "";
    const provider = message.providerId && (await ctx.db.get("providers", message.providerId));
    // Free providers (local models) cost nothing; a provider-reported cost beats the table.
    const cost = provider && provider.free ? 0 : (reportedCostMicroUsd ?? costMicroUsd(usage, priceFor(model)));
    await ctx.db.patch("messages", messageId, { status, content, error, usage, costMicroUsd: cost ?? undefined });
    await recordDailyUsage(ctx, {
      ownerId: message.ownerId,
      at: Date.now(),
      model,
      providerId: message.providerId ?? "",
      threadId: message.threadId,
      usage,
      costMicroUsd: cost,
    });
    if (provider && reports) {
      const known = provider.capabilities ?? { caching: false, reasoning: false };
      const capabilities = { caching: known.caching || reports.caching, reasoning: known.reasoning || reports.reasoning };
      if (capabilities.caching !== known.caching || capabilities.reasoning !== known.reasoning || !provider.capabilities) {
        await ctx.db.patch("providers", provider._id, { capabilities });
      }
    }
    return null;
  },
});
