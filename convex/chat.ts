import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { CURRENT_SYSTEM_PROMPT_VERSION } from "./lib/systemPrompts";
import { appendChunk, createStream, streamText } from "./lib/textStream";
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
  role: v.union(v.literal("user"), v.literal("assistant")),
  status: v.union(v.literal("streaming"), v.literal("done"), v.literal("stopped"), v.literal("error")),
  text: v.string(),
  error: v.optional(v.string()),
});

export const getThread = query({
  args: { threadId: v.id("threads") },
  returns: v.object({
    title: v.string(),
    providerId: v.id("providers"),
    modelId: v.string(),
    messages: v.array(messageView),
  }),
  handler: async (ctx, { threadId }) => {
    const thread = await ownedThread(ctx, await requireOwner(ctx), threadId);
    const branch = await activeBranch(ctx, thread);
    const messages = await Promise.all(
      branch.map(async (m) => ({
        _id: m._id,
        role: m.role,
        status: m.status,
        // A streaming reply reads its text from the stream, so a reload or a second
        // device sees what has arrived so far and keeps updating.
        text: m.status === "streaming" && m.streamId ? await streamText(ctx, m.streamId) : m.content,
        error: m.error,
      })),
    );
    return { title: thread.title, providerId: thread.providerId, modelId: thread.modelId, messages };
  },
});

export const send = mutation({
  args: { threadId: v.id("threads"), content: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, content }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    const text = content.trim();
    if (!text) throw new ConvexError("Message is empty");

    const parent = thread.activeLeafId ? await ctx.db.get("messages", thread.activeLeafId) : null;
    if (parent?.status === "streaming") throw new ConvexError("Wait for the reply to finish, or stop it");
    const userId = await ctx.db.insert("messages", {
      ownerId,
      threadId,
      parentId: parent?._id,
      ancestorIds: parent ? [...parent.ancestorIds, parent._id] : [],
      role: "user",
      pinned: false,
      content: text,
      status: "done",
    });
    const user = (await ctx.db.get("messages", userId))!;
    const assistantId = await ctx.db.insert("messages", {
      ownerId,
      threadId,
      parentId: userId,
      ancestorIds: [...user.ancestorIds, userId],
      role: "assistant",
      pinned: false,
      content: "",
      status: "streaming",
      streamId: await createStream(ctx),
      model: thread.modelId,
      providerId: thread.providerId,
    });
    // ponytail: first message as title until side-job titles land (ticket 11).
    const title = thread.activeLeafId ? thread.title : text.slice(0, 60);
    await ctx.db.patch("threads", threadId, { activeLeafId: assistantId, title });
    await ctx.scheduler.runAfter(0, internal.chatActions.generate, { messageId: assistantId });
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
      provider: v.union(v.null(), v.object({ baseUrl: v.string(), apiKeyEncrypted: v.string() })),
      allowlist: v.array(v.string()),
      history: v.array(v.object({ role: v.union(v.literal("user"), v.literal("assistant")), content: v.string() })),
    }),
  ),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming" || !message.streamId) return null;
    const thread = (await ctx.db.get("threads", message.threadId))!;
    const provider = await ctx.db.get("providers", thread.providerId);
    const ancestors = await Promise.all(message.ancestorIds.map((id) => ctx.db.get("messages", id)));
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
      .unique();
    return {
      streamId: message.streamId,
      model: thread.modelId,
      systemPromptVersion: thread.systemPromptVersion,
      provider: provider && { baseUrl: provider.baseUrl, apiKeyEncrypted: provider.apiKeyEncrypted },
      allowlist: settings?.allowlistedHosts ?? [],
      history: ancestors
        .filter((m) => m !== null && m.content !== "")
        .map((m) => ({ role: m!.role, content: m!.content })),
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
  },
  returns: v.null(),
  handler: async (ctx, { messageId, status, content, pending, error }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming") return null;
    if (message.streamId) await appendChunk(ctx, message.streamId, pending, true);
    await ctx.db.patch("messages", messageId, { status, content, error });
    return null;
  },
});
