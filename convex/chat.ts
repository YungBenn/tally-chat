import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { CURRENT_SYSTEM_PROMPT_VERSION } from "./lib/systemPrompts";
import { cacheExpiresAt, cacheTtlValidator } from "./lib/cacheStatus";
import { keepalivePending, restartKeepalive, touchedCache } from "./keepalive";
import { coveredIds, scheduleCondense } from "./condense";
import { assertWithinBudget, budgetReached } from "./lib/budget";
import { assembleHistory } from "./lib/context";
import {
  MODE_MAX_TOKENS,
  outputModeValidator,
  type OutputMode,
} from "./lib/outputModes";
import { supportsPerMessageEffort } from "./lib/anthropic";
import {
  imageValidator,
  MAX_IMAGES_PER_MESSAGE,
  type MessageImage,
} from "./lib/images";
import { DEFAULT_EFFORT, effortValidator, type Effort } from "./lib/effort";
import { meterCall } from "./lib/metering";
import {
  appendChunk,
  createStream,
  deleteStream,
  streamText,
} from "./lib/textStream";
import { priceFor, usageValidator } from "./lib/usage";
import { requireOwner } from "./owner";

async function ownedThread(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  threadId: Id<"threads">,
) {
  const thread = await ctx.db.get("threads", threadId);
  if (!thread || thread.ownerId !== ownerId)
    throw new ConvexError("Thread not found");
  return thread;
}

// The active branch, root first: the leaf's ancestorIds plus the leaf, fetched in one batch.
export async function activeBranch(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<Doc<"messages">[]> {
  if (!thread.activeLeafId) return [];
  const leaf = await ctx.db.get("messages", thread.activeLeafId);
  if (!leaf) return [];
  const ancestors = await Promise.all(
    leaf.ancestorIds.map((id) => ctx.db.get("messages", id)),
  );
  return [...ancestors.filter((m) => m !== null), leaf];
}

export const threadRow = v.object({
  _id: v.id("threads"),
  startedAt: v.number(),
  title: v.string(),
});
export const toRow = (t: Doc<"threads">) => ({
  _id: t._id,
  startedAt: t.startedAt ?? t._creationTime,
  title: t.title,
});

// The owner's 100 most recently started threads, newest first.
export const listThreads = query({
  args: {},
  returns: v.array(threadRow),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_ownerId_and_startedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    return threads.map(toRow);
  },
});

export const createThread = mutation({
  args: {
    providerId: v.id("providers"),
    modelId: v.string(),
    effort: v.optional(effortValidator),
  },
  returns: v.id("threads"),
  handler: async (ctx, { providerId, modelId, effort }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    if (!provider.models.some((m) => m.id === modelId && !m.hidden))
      throw new ConvexError("Model not available");
    return ctx.db.insert("threads", {
      ownerId,
      title: "New thread",
      providerId,
      modelId,
      systemPromptVersion: CURRENT_SYSTEM_PROMPT_VERSION,
      startedAt: Date.now(),
      // Only Anthropic-style threads send effort (spec phase 4).
      effort:
        provider.apiStyle === "anthropic"
          ? (effort ?? DEFAULT_EFFORT)
          : undefined,
    });
  },
});

const messageView = v.object({
  _id: v.id("messages"),
  siblingIds: v.array(v.id("messages")), // this message's versions (itself included), oldest first
  role: v.union(v.literal("user"), v.literal("assistant")),
  pinned: v.boolean(), // never folded into a summary (spec phase 6)
  pinLocked: v.boolean(), // a checkpoint covers it, so its pin can't change
  status: v.union(
    v.literal("streaming"),
    v.literal("done"),
    v.literal("stopped"),
    v.literal("error"),
  ),
  text: v.string(),
  error: v.optional(v.string()),
  model: v.optional(v.string()),
  modelName: v.optional(v.string()), // the provider's display name for model, when it still lists it
  usage: v.optional(usageValidator),
  costMicroUsd: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  effort: v.optional(effortValidator),
  images: v.optional(
    v.array(
      v.object({
        url: v.union(v.null(), v.string()),
        width: v.number(),
        height: v.number(),
      }),
    ),
  ),
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
      // The latest checkpoint on the branch: it covers the first coveredCount messages (spec phase 6).
      checkpoint: v.union(
        v.null(),
        v.object({
          coveredCount: v.number(),
          turns: v.number(),
          summary: v.string(),
        }),
      ),
      cacheManaged: v.boolean(), // Anthropic-style provider: tally.chat places its cache breakpoints
      vision: v.boolean(), // the thread's model accepts images
      cacheExpiresAt: v.union(v.null(), v.number()), // judge warm/cold/keepalive with lib/cacheStatus
      keepaliveScheduled: v.boolean(),
      lastActiveAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    const branch = await activeBranch(ctx, thread);
    // Display names from each reply's provider (one read per distinct provider).
    const providerIds = [
      ...new Set(branch.flatMap((m) => (m.providerId ? [m.providerId] : []))),
    ];
    const providers = new Map(
      providerIds.map((id) => [id, ctx.db.get("providers", id)]),
    );
    const modelName = async (m: Doc<"messages">) =>
      m.providerId && m.model
        ? (await providers.get(m.providerId))?.models.find(
            (x) => x.id === m.model,
          )?.displayName
        : undefined;
    const covered = await coveredIds(ctx, thread._id);
    const messages = await Promise.all(
      branch.map(async (m) => ({
        _id: m._id,
        pinned: m.pinned,
        pinLocked: covered.has(m._id),
        siblingIds: (
          await ctx.db
            .query("messages")
            .withIndex("by_thread_parent", (q) =>
              q.eq("threadId", thread._id).eq("parentId", m.parentId),
            )
            .take(100)
        ).map((s) => s._id),
        role: m.role,
        status: m.status,
        // A streaming reply reads its text from the stream, so a reload or a second
        // device sees what has arrived so far and keeps updating.
        text:
          m.status === "streaming" && m.streamId
            ? await streamText(ctx, m.streamId)
            : m.content,
        error: m.error,
        model: m.model,
        modelName: await modelName(m),
        usage: m.usage,
        costMicroUsd: m.costMicroUsd,
        truncated: m.truncated,
        effort: m.effort,
        images: m.images
          ? await Promise.all(
              m.images.map(async (i) => ({
                url: await ctx.storage.getUrl(i.storageId),
                width: i.width,
                height: i.height,
              })),
            )
          : undefined,
      })),
    );
    const { checkpoint } = await assembleHistory(
      ctx,
      thread._id,
      branch.map((m) => m._id),
    );
    const coveredCount = checkpoint
      ? branch.findIndex((m) => m._id === checkpoint.coversUpToId) + 1
      : 0;
    return {
      title: thread.title,
      providerId: thread.providerId,
      modelId: thread.modelId,
      messages,
      checkpoint: checkpoint && {
        coveredCount,
        turns: branch.slice(0, coveredCount).filter((m) => m.role === "user")
          .length,
        summary: checkpoint.summary,
      },
      cacheManaged:
        (await ctx.db.get("providers", thread.providerId))?.apiStyle ===
        "anthropic",
      vision:
        (await ctx.db.get("providers", thread.providerId))?.models.find(
          (m) => m.id === thread.modelId,
        )?.vision === true,
      cacheExpiresAt: cacheExpiresAt(thread),
      keepaliveScheduled: await keepalivePending(ctx, thread),
      lastActiveAt: thread.lastActiveAt ?? null,
    };
  },
});

async function assertNotStreaming(ctx: QueryCtx, thread: Doc<"threads">) {
  const leaf = thread.activeLeafId
    ? await ctx.db.get("messages", thread.activeLeafId)
    : null;
  if (leaf?.status === "streaming")
    throw new ConvexError("Wait for the reply to finish, or stop it");
}

function cleanText(content: string) {
  const text = content.trim();
  if (!text) throw new ConvexError("Message is empty");
  return text;
}

async function appendUserMessage(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  parent: Doc<"messages"> | null,
  text: string,
  effort?: Effort, // a per-message effort change, made on this message and never changed after
  images?: MessageImage[],
  replyModel?: ReplyModel, // the model answering it, when not the thread's
) {
  if (effort) await assertPerMessageEffort(ctx, thread);
  if (images?.length)
    await assertImagesAllowed(ctx, thread, images, replyModel);
  const id = await ctx.db.insert("messages", {
    ownerId: thread.ownerId,
    threadId: thread._id,
    parentId: parent?._id,
    ancestorIds: parent ? [...parent.ancestorIds, parent._id] : [],
    role: "user",
    pinned: false,
    content: text,
    status: "done",
    effort,
    images: images?.length ? images : undefined,
  });
  return (await ctx.db.get("messages", id))!;
}

// The effort a thread's requests send (spec phase 4): Anthropic-style threads only; threads from
// before phase 4 run at the default.
export const effortFor = (
  thread: Doc<"threads">,
  provider: Doc<"providers"> | null,
) =>
  provider?.apiStyle === "anthropic"
    ? (thread.effort ?? DEFAULT_EFFORT)
    : undefined;

// The effort in force for a reply to `user` on `provider`: the latest per-message change on its
// branch, else the thread's level (spec phase 4). Only Anthropic-style replies carry one, so a
// cheaper reply on another provider gets none (spec phase 7).
async function effortInForce(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  user: Doc<"messages">,
  provider: Doc<"providers"> | null,
) {
  const base = effortFor(thread, provider);
  if (!base) return undefined;
  if (user.effort) return user.effort;
  const ancestors = await Promise.all(
    user.ancestorIds.map((id) => ctx.db.get("messages", id)),
  );
  return (
    ancestors.findLast((m) => m?.role === "user" && m.effort)?.effort ?? base
  );
}

// Images only go to models that accept them, at most a handful per message, and only files this
// owner just uploaded as images (spec phase 4).
async function assertImagesAllowed(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  images: MessageImage[],
  replyModel?: ReplyModel,
) {
  const { providerId, modelId } = replyModel ?? thread;
  const provider = await ctx.db.get("providers", providerId);
  if (!provider?.models.find((m) => m.id === modelId)?.vision) {
    throw new ConvexError("This model doesn't accept images");
  }
  if (images.length > MAX_IMAGES_PER_MESSAGE)
    throw new ConvexError(
      `At most ${MAX_IMAGES_PER_MESSAGE} images per message`,
    );
  for (const image of images) {
    const file = await ctx.db.system.get("_storage", image.storageId);
    if (!file?.contentType?.startsWith("image/"))
      throw new ConvexError("That upload isn't an image");
  }
}

async function assertPerMessageEffort(ctx: QueryCtx, thread: Doc<"threads">) {
  const provider = await ctx.db.get("providers", thread.providerId);
  if (
    provider?.apiStyle !== "anthropic" ||
    !supportsPerMessageEffort(thread.modelId)
  ) {
    throw new ConvexError("This model can't change effort per message");
  }
}

// A model to answer one send or retry instead of the thread's (spec phase 7, cheaper reply).
const replyModelValidator = v.object({
  providerId: v.id("providers"),
  modelId: v.string(),
});
type ReplyModel = { providerId: Id<"providers">; modelId: string };

// A reply written by a model other than its thread's: a cheaper reply. It never touches the
// thread's cache bookkeeping (spec phase 7). Replies from before phase 7 always record theirs.
export const isCheaperReply = (
  m: Pick<Doc<"messages">, "providerId" | "model">,
  thread: Pick<Doc<"threads">, "providerId" | "modelId">,
) =>
  m.providerId !== undefined &&
  (m.providerId !== thread.providerId || m.model !== thread.modelId);

// The provider that answers: the thread's, or a visible model of another of the owner's. The
// whole branch goes to it, so it must accept images when the branch has any.
async function replyProvider(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  user: Doc<"messages">,
  replyModel?: ReplyModel,
) {
  if (
    !replyModel ||
    (replyModel.providerId === thread.providerId &&
      replyModel.modelId === thread.modelId)
  )
    return {
      provider: await ctx.db.get("providers", thread.providerId),
      modelId: thread.modelId,
    };
  const provider = await ctx.db.get("providers", replyModel.providerId);
  if (!provider || provider.ownerId !== thread.ownerId)
    throw new ConvexError("Provider not found");
  const model = provider.models.find(
    (m) => m.id === replyModel.modelId && !m.hidden,
  );
  if (!model) throw new ConvexError("Model not available");
  if (!model.vision) {
    const branch = await Promise.all(
      user.ancestorIds.map((id) => ctx.db.get("messages", id)),
    );
    if ([...branch, user].some((m) => m?.images?.length))
      throw new ConvexError(
        "This model doesn't accept images, and this thread has some",
      );
  }
  return { provider, modelId: model.id };
}

// A new streaming reply under `user`, made the active leaf, with generation scheduled.
// Send, retry and edit all start their reply here, so the soft budget is enforced once.
async function startReply(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  user: Doc<"messages">,
  outputMode?: OutputMode,
  replyModel?: ReplyModel,
) {
  await assertWithinBudget(ctx, thread.ownerId);
  const { provider, modelId } = await replyProvider(
    ctx,
    thread,
    user,
    replyModel,
  );
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
    model: modelId,
    providerId: provider?._id ?? thread.providerId,
    outputMode,
    effort: await effortInForce(ctx, thread, user, provider),
  });
  // ponytail: first message as title until side-job titles land (ticket 11).
  const title = thread.activeLeafId ? thread.title : user.content.slice(0, 60);
  await ctx.db.patch("threads", thread._id, {
    activeLeafId: assistantId,
    title,
  });
  await ctx.scheduler.runAfter(0, internal.chatActions.generate, {
    messageId: assistantId,
  });
}

async function ownedMessage(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  messageId: Id<"messages">,
) {
  const message = await ctx.db.get("messages", messageId);
  if (!message || message.ownerId !== ownerId)
    throw new ConvexError("Message not found");
  return message;
}

export const send = mutation({
  args: {
    threadId: v.id("threads"),
    content: v.string(),
    mode: v.optional(outputModeValidator),
    effort: v.optional(effortValidator), // change effort from this message on (supported models)
    images: v.optional(v.array(imageValidator)),
    model: v.optional(replyModelValidator), // reply with this model once (spec phase 7)
  },
  returns: v.null(),
  handler: async (ctx, { threadId, content, mode, effort, images, model }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    const text = cleanText(content);
    await assertNotStreaming(ctx, thread);
    if (effort && model)
      throw new ConvexError(
        "Change effort on a reply from the thread's own model",
      );
    const parent = thread.activeLeafId
      ? await ctx.db.get("messages", thread.activeLeafId)
      : null;
    await startReply(
      ctx,
      thread,
      await appendUserMessage(ctx, thread, parent, text, effort, images, model),
      mode,
      model,
    );
    return null;
  },
});

// A new reply beside an existing one, under the same user message (ADR 0001: nothing is overwritten).
export const retry = mutation({
  args: {
    messageId: v.id("messages"),
    mode: v.optional(outputModeValidator),
    model: v.optional(replyModelValidator), // retry with this model (spec phase 7)
  },
  returns: v.null(),
  handler: async (ctx, { messageId, mode, model }) => {
    const ownerId = await requireOwner(ctx);
    const reply = await ownedMessage(ctx, ownerId, messageId);
    if (reply.role !== "assistant" || !reply.parentId)
      throw new ConvexError("Only replies can be retried");
    const thread = await ownedThread(ctx, ownerId, reply.threadId);
    await assertNotStreaming(ctx, thread);
    await startReply(
      ctx,
      thread,
      (await ctx.db.get("messages", reply.parentId))!,
      mode,
      model,
    );
    return null;
  },
});

// Editing is a fork: a new user message beside the edited one, then a reply to it.
export const edit = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    mode: v.optional(outputModeValidator),
    effort: v.optional(effortValidator),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, content, mode, effort }) => {
    const ownerId = await requireOwner(ctx);
    const original = await ownedMessage(ctx, ownerId, messageId);
    if (original.role !== "user")
      throw new ConvexError("Only your messages can be edited");
    const thread = await ownedThread(ctx, ownerId, original.threadId);
    const text = cleanText(content);
    await assertNotStreaming(ctx, thread);
    const parent = original.parentId
      ? await ctx.db.get("messages", original.parentId)
      : null;
    await startReply(
      ctx,
      thread,
      // The edited version keeps the original's effort change unless a new one is given.
      await appendUserMessage(
        ctx,
        thread,
        parent,
        text,
        effort ?? original.effort,
        original.images, // an edit changes the text; the images stay
      ),
      mode,
    );
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
        .withIndex("by_thread_parent", (q) =>
          q.eq("threadId", leaf.threadId).eq("parentId", leaf._id),
        )
        .order("desc")
        .first();
      if (!child) break;
      leaf = child;
    }
    await ctx.db.patch("threads", leaf.threadId, { activeLeafId: leaf._id });
    return null;
  },
});

// Where the browser uploads an image (already downscaled) before sending it with a message.
export const generateImageUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Changes a thread's effort level for every request from now on. This changes the top-level
// request, so the history is written to the cache again; the composer uses it only for models
// without per-message effort, after a cache-break hint (spec phase 4).
export const setThreadEffort = mutation({
  args: { threadId: v.id("threads"), effort: effortValidator },
  returns: v.null(),
  handler: async (ctx, { threadId, effort }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    if (
      (await ctx.db.get("providers", thread.providerId))?.apiStyle !==
      "anthropic"
    ) {
      throw new ConvexError("This provider has no effort setting");
    }
    await ctx.db.patch("threads", threadId, { effort });
    return null;
  },
});

// Presence for keepalive: the owner has the thread open in a focused tab, or is typing in it.
// A deleted or foreign thread is ignored, not refused: a tab left open there has nothing to fix.
export const markActive = mutation({
  args: { threadId: v.id("threads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (thread?.ownerId === ownerId)
      await ctx.db.patch("threads", threadId, { lastActiveAt: Date.now() });
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
      if (m.status === "streaming") {
        if (!m.stopRequested)
          await ctx.db.patch("messages", m._id, { stopRequested: true });
        waiting = true;
        continue;
      }
      if (m.streamId) await deleteStream(ctx, m.streamId);
      for (const image of m.images ?? [])
        await ctx.storage.delete(image.storageId);
      await ctx.db.delete("messages", m._id);
    }
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const c of checkpoints) await ctx.db.delete("checkpoints", c._id);
    const sideJobs = await ctx.db
      .query("sideJobs")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const j of sideJobs) await ctx.db.delete("sideJobs", j._id);

    const more = [messages, checkpoints, sideJobs].some(
      (rows) => rows.length === PURGE_BATCH,
    );
    // A reply that never finishes is closed by sweepStuckReplies, so waiting always ends.
    if (more || waiting)
      await ctx.scheduler.runAfter(
        waiting && !more ? 2000 : 0,
        internal.chat.purgeThread,
        { threadId },
      );
    return null;
  },
});

// Convex actions time out after 10 minutes, so a reply still "streaming" after this long
// lost its action (crash, restart, timeout) and will never finish on its own.
export const STUCK_REPLY_MS = 15 * 60 * 1000;

// Cron: closes stuck replies as errors, keeping whatever text arrived, so the thread can be
// used again and a thread delete waiting on them can finish. Usage was never reported for
// them, so nothing is metered.
export const sweepStuckReplies = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_status", (q) =>
        q
          .eq("status", "streaming")
          .lt("_creationTime", Date.now() - STUCK_REPLY_MS),
      )
      .take(100);
    for (const m of stuck) {
      const content = m.streamId ? await streamText(ctx, m.streamId) : "";
      await ctx.runMutation(internal.chat.finalize, {
        messageId: m._id,
        status: "error",
        content,
        pending: "",
        error: "The reply was interrupted",
      });
    }
    return stuck.length;
  },
});

export const stop = mutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.ownerId !== ownerId)
      throw new ConvexError("Message not found");
    if (message.status === "streaming")
      await ctx.db.patch("messages", messageId, { stopRequested: true });
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
      effort: v.optional(effortValidator),
      systemPromptVersion: v.number(),
      provider: v.union(
        v.null(),
        v.object({
          apiStyle: v.union(
            v.literal("anthropic"),
            v.literal("openai-compatible"),
          ),
          baseUrl: v.string(),
          apiKeyEncrypted: v.string(),
        }),
      ),
      allowlist: v.array(v.string()),
      history: v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
          effort: v.optional(effortValidator),
          images: v.optional(v.array(imageValidator)),
        }),
      ),
      layerEnd: v.number(),
      cacheTtl: cacheTtlValidator,
      maxTokens: v.number(),
    }),
  ),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming" || !message.streamId)
      return null;
    const thread = await ctx.db.get("threads", message.threadId);
    if (!thread) return null; // deleted while queued; purgeThread stops and removes the reply
    // The reply's own model: the thread's, or another one for a cheaper reply (spec phase 7).
    const provider = await ctx.db.get(
      "providers",
      message.providerId ?? thread.providerId,
    );
    const model = message.model ?? thread.modelId;
    const oneOff = isCheaperReply(message, thread);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
      .unique();
    const history = await assembleHistory(
      ctx,
      message.threadId,
      message.ancestorIds,
    );
    return {
      streamId: message.streamId,
      model,
      systemPromptVersion: thread.systemPromptVersion,
      provider: provider && {
        apiStyle: provider.apiStyle,
        baseUrl: provider.baseUrl,
        apiKeyEncrypted: provider.apiKeyEncrypted,
      },
      allowlist: settings?.allowlistedHosts ?? [],
      // A cheaper reply starts cold, so it sends the level in force once, at the top, rather than
      // per-message changes its model may not accept (spec phase 7).
      history: oneOff
        ? history.messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images ? { images: m.images } : {}),
          }))
        : history.messages,
      layerEnd: history.layerEnd,
      // With keepalive off, pauses up to an hour stay cheap from the second turn on (the first
      // turn's prefix is too short to be worth a 2x write). On, keepalive covers the pauses.
      maxTokens: MODE_MAX_TOKENS[message.outputMode ?? "normal"],
      effort: oneOff ? message.effort : effortFor(thread, provider),
      cacheTtl:
        settings?.keepaliveEnabled === false && message.ancestorIds.length > 1
          ? ("1h" as const)
          : ("5m" as const),
    };
  },
});

export const stopRequested = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, { messageId }) =>
    (await ctx.db.get("messages", messageId))?.stopRequested === true,
});

// The single transition out of "streaming". Content is written here once and never again.
export const finalize = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(
      v.literal("done"),
      v.literal("stopped"),
      v.literal("error"),
    ),
    content: v.string(),
    pending: v.string(),
    error: v.optional(v.string()),
    usage: v.optional(usageValidator),
    reports: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
    reportedCostMicroUsd: v.optional(v.number()),
    cacheRequest: v.optional(
      v.object({ startedAt: v.number(), ttl: cacheTtlValidator }),
    ),
    truncated: v.optional(v.boolean()), // the provider stopped at max_tokens
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      messageId,
      status,
      content,
      pending,
      error,
      usage,
      reports,
      reportedCostMicroUsd,
      cacheRequest,
      truncated,
    },
  ) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming") return null;
    if (message.streamId)
      await appendChunk(ctx, message.streamId, pending, true);
    if (!usage) {
      await ctx.db.patch("messages", messageId, {
        status,
        content,
        error,
        truncated,
      });
      const thread = await ctx.db.get("threads", message.threadId);
      if (status === "done" && thread) await scheduleCondense(ctx, thread);
      return null;
    }

    const cost = await meterCall(ctx, {
      ownerId: message.ownerId,
      threadId: message.threadId,
      providerId: message.providerId,
      model: message.model ?? "",
      normalized: { usage, reports, reportedCostMicroUsd },
    });
    await ctx.db.patch("messages", messageId, {
      status,
      content,
      error,
      truncated,
      usage,
      costMicroUsd: cost ?? undefined,
    });

    const thread = await ctx.db.get("threads", message.threadId);
    // A cheaper reply's cache belongs to another model: the thread's touch and keepalive stay.
    if (thread && !isCheaperReply(message, thread)) {
      // A cache-marked request that the provider says read or wrote the cache touched it.
      const touchedAt =
        cacheRequest && touchedCache(usage) ? cacheRequest.startedAt : null;
      if (touchedAt !== null)
        await ctx.db.patch("threads", thread._id, {
          cacheTouchedAt: touchedAt,
          cacheTtl: cacheRequest!.ttl,
        });
      await restartKeepalive(ctx, thread, touchedAt);
    }

    // The first successful reply in a thread gets a side-job title, once (from the thread's
    // first message, so a failed first reply doesn't leave the thread untitled).
    if (status === "done" && thread && !thread.titleRequested) {
      await ctx.db.patch("threads", thread._id, { titleRequested: true });
      await ctx.scheduler.runAfter(0, internal.chatActions.generateTitle, {
        threadId: thread._id,
        replyId: messageId,
      });
    }
    // A finished reply may have grown the thread past the condense threshold (spec phase 6).
    if (status === "done" && thread) await scheduleCondense(ctx, thread);
    return null;
  },
});

// A provider's cheapest visible model with input and output prices (by their sum), if any.
export function cheapestPricedModel(provider: Doc<"providers">) {
  return provider.models
    .filter((m) => !m.hidden)
    .map((m) => ({ ...m, price: priceFor(m.id) }))
    .filter((m) => m.price?.input !== undefined && m.price.output !== undefined)
    .sort(
      (a, b) =>
        a.price!.input! +
        a.price!.output! -
        (b.price!.input! + b.price!.output!),
    )[0];
}

// The side-job model for a thread: the owner's choice if it still exists and is visible,
// otherwise the cheapest priced visible model of the thread's provider, else the thread's model.
export async function sideJobModelFor(ctx: QueryCtx, thread: Doc<"threads">) {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", thread.ownerId))
    .unique();
  const chosen = settings?.sideJobModel;
  if (chosen) {
    const provider = await ctx.db.get("providers", chosen.providerId);
    if (
      provider &&
      provider.models.some((m) => m.id === chosen.modelId && !m.hidden)
    ) {
      return { provider, model: chosen.modelId };
    }
  }
  const provider = await ctx.db.get("providers", thread.providerId);
  if (!provider) return null;
  return {
    provider,
    model: cheapestPricedModel(provider)?.id ?? thread.modelId,
  };
}

export const titleJobInput = internalQuery({
  args: {
    threadId: v.id("threads"),
    replyId: v.id("messages"),
    now: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      question: v.string(),
      answer: v.string(),
      providerId: v.id("providers"),
      provider: v.object({
        apiStyle: v.union(
          v.literal("anthropic"),
          v.literal("openai-compatible"),
        ),
        baseUrl: v.string(),
        apiKeyEncrypted: v.string(),
      }),
      model: v.string(),
      allowlist: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { threadId, replyId, now }) => {
    const thread = await ctx.db.get("threads", threadId);
    const reply = await ctx.db.get("messages", replyId);
    const firstId = reply?.ancestorIds[0];
    const question = firstId && (await ctx.db.get("messages", firstId));
    if (!thread || !reply || !question) return null;
    const sideJob = await sideJobModelFor(ctx, thread);
    if (!sideJob) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", thread.ownerId))
      .unique();
    if (await budgetReached(ctx, settings, now)) return null; // side jobs pause while over budget
    const { apiStyle, baseUrl, apiKeyEncrypted } = sideJob.provider;
    return {
      question: question.content,
      answer: reply.content,
      providerId: sideJob.provider._id,
      provider: { apiStyle, baseUrl, apiKeyEncrypted },
      model: sideJob.model,
      allowlist: settings?.allowlistedHosts ?? [],
    };
  },
});

// Saves a side-job title (if one came back) and meters the call (if usage came back).
export const saveTitle = internalMutation({
  args: {
    threadId: v.id("threads"),
    providerId: v.id("providers"),
    model: v.string(),
    title: v.optional(v.string()),
    usage: v.optional(usageValidator),
    reports: v.optional(
      v.object({ caching: v.boolean(), reasoning: v.boolean() }),
    ),
    reportedCostMicroUsd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      threadId,
      providerId,
      model,
      title,
      usage,
      reports,
      reportedCostMicroUsd,
    },
  ) => {
    const thread = await ctx.db.get("threads", threadId);
    if (!thread) return null; // deleted meanwhile: nothing left to title or bill against
    if (title) await ctx.db.patch("threads", threadId, { title });
    if (usage) {
      const cost = await meterCall(ctx, {
        ownerId: thread.ownerId,
        threadId,
        providerId,
        model,
        normalized: { usage, reports, reportedCostMicroUsd },
      });
      await ctx.db.insert("sideJobs", {
        ownerId: thread.ownerId,
        threadId,
        kind: "title",
        providerId,
        model,
        usage,
        costMicroUsd: cost ?? undefined,
      });
    }
    return null;
  },
});
