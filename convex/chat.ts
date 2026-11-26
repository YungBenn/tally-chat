import { ConvexError, v, type ObjectType } from "convex/values";
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
import { CURRENT_SYSTEM_PROMPT_VERSION, systemPrompt } from "./lib/systemPrompts";
import { cacheTtlValidator, requestCacheTtl } from "./lib/cacheStatus";
import { restartKeepalive, touchedCache, warmAfterCondense } from "./keepalive";
import { patchThreadState, threadState } from "./threadState";
import { coveredIds, scheduleCondense } from "./condense";
import { assertWithinBudget, BUDGET_REACHED, budgetReached } from "./lib/budget";
import { ancestorIds, insertMessage } from "./lib/ancestors";
import { assembleHistory, latestCheckpoint } from "./lib/context";
import {
  outputCeiling,
  outputModeValidator,
  QUICK_BREVITY,
  type OutputMode,
} from "./lib/outputModes";
import { supportsPerMessageEffort } from "./lib/anthropic";
import {
  imageValidator,
  MAX_IMAGES_PER_MESSAGE,
  type MessageImage,
} from "./lib/images";
import {
  DEFAULT_EFFORT,
  defaultEffortFor,
  effortValidator,
  higherEffort,
  supportsEffort,
  type Effort,
} from "./lib/effort";
import { meterCall } from "./lib/metering";
import {
  appendStream,
  createStream,
  deleteStream,
  streamText,
} from "./lib/textStream";
import { priceFor, sumCost, sumUsage, usageValidator } from "./lib/usage";
import {
  APPROVAL_TIMEOUT_MS,
  chatMessageValidator,
  joinText,
  MAX_STEPS,
  nextStep,
  expandParts,
  toolStatusValidator,
  usedTools,
  type Part,
  type ToolStatus,
} from "./lib/toolParts";
import {
  freezeTools,
  supportsTools,
  toDefinition,
  toolDefinitionValidator,
  toolPickValidator,
  type ToolPick,
} from "./lib/toolSet";
import { requireOwner } from "./owner";
import { importSourceValidator } from "./schema";
import {
  MAX_DOCUMENTS_PER_MESSAGE,
  type DocumentRef,
} from "./lib/documents";

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

// The active branch, root first: the leaf's ancestors plus the leaf, fetched in one batch.
export async function activeBranch(
  ctx: QueryCtx,
  thread: Doc<"threads">,
): Promise<Doc<"messages">[]> {
  if (!thread.activeLeafId) return [];
  const leaf = await ctx.db.get("messages", thread.activeLeafId);
  if (!leaf) return [];
  const ancestors = await Promise.all(
    (await ancestorIds(ctx, leaf)).map((id) => ctx.db.get("messages", id)),
  );
  return [...ancestors.filter((m) => m !== null), leaf];
}

export const threadRow = v.object({
  _id: v.id("threads"),
  startedAt: v.number(),
  title: v.string(),
  pinned: v.boolean(),
});
export const toRow = (t: Doc<"threads">) => ({
  _id: t._id,
  startedAt: t.startedAt ?? t._creationTime,
  title: t.title,
  pinned: t.pinnedAt !== undefined,
});

// A sidebar row also says whether the thread's model can call tools (the "Change tools" action).
const listRow = v.object({ ...threadRow.fields, tools: v.boolean() });

// Pinned threads (most recently pinned first), then the owner's 100 most recently started
// unpinned threads, newest first.
export const listThreads = query({
  args: {},
  returns: v.array(listRow),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const pinned = await ctx.db
      .query("threads")
      .withIndex("by_ownerId_and_pinnedAt", (q) =>
        q.eq("ownerId", ownerId).gt("pinnedAt", 0),
      )
      .order("desc")
      .take(100);
    const recent = await ctx.db
      .query("threads")
      .withIndex("by_ownerId_and_startedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
    const providers = new Map<Id<"providers">, Doc<"providers"> | null>();
    const rows = [...pinned, ...recent.filter((t) => t.pinnedAt === undefined)];
    for (const t of rows)
      if (!providers.has(t.providerId))
        providers.set(t.providerId, await ctx.db.get("providers", t.providerId));
    return rows.map((t) => ({
      ...toRow(t),
      tools: supportsTools(providers.get(t.providerId) ?? null, t.modelId),
    }));
  },
});

// The tools a thread carries now, for the "Change tools" dialog's starting picks.
export const threadTools = query({
  args: { threadId: v.id("threads") },
  returns: v.union(
    v.null(),
    v.object({
      capable: v.boolean(),
      picks: v.array(toolPickValidator),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    return {
      capable: supportsTools(
        await ctx.db.get("providers", thread.providerId),
        thread.modelId,
      ),
      picks: (thread.toolSet ?? []).map(({ serverId, tool }) => ({
        serverId,
        tool,
      })),
    };
  },
});

// Replaces a thread's frozen tool set with the current definitions of the chosen tools (spec
// phase 10). Tool definitions are the top of every request, so the next one writes the whole
// history to the cache again; the dialog that calls this says so, with the price. A thread-level
// change, not a message: it applies to the whole branch from the next request on.
export const setThreadTools = mutation({
  args: { threadId: v.id("threads"), tools: v.array(toolPickValidator) },
  returns: v.null(),
  handler: async (ctx, { threadId, tools }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    await assertNotStreaming(ctx, thread);
    await ctx.db.patch("threads", threadId, { toolSet: undefined });
    await freezeToolSet(ctx, { ...thread, toolSet: undefined }, tools);
    // The cached prefix no longer matches what the next request sends: it reads cold now, and
    // a keepalive writes the new one if the owner is still here (as after a condense).
    const fresh = (await ctx.db.get("threads", threadId))!;
    if (thread.activeLeafId) await warmAfterCondense(ctx, fresh);
    return null;
  },
});

export const MAX_TITLE_LENGTH = 200;

// The owner's own name for a thread; the one-time side-job title never overwrites it.
export const renameThread = mutation({
  args: { threadId: v.id("threads"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, title }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    const name = title.replace(/\s+/g, " ").trim();
    if (!name) throw new ConvexError("A thread needs a name");
    if (name.length > MAX_TITLE_LENGTH)
      throw new ConvexError(`Keep the name under ${MAX_TITLE_LENGTH} characters`);
    await ctx.db.patch("threads", thread._id, {
      title: name,
      renamed: true,
      titleRequested: true, // no title job spends money on a thread that has a name
    });
    return null;
  },
});

export const setThreadPinned = mutation({
  args: { threadId: v.id("threads"), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, pinned }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ownedThread(ctx, ownerId, threadId);
    await ctx.db.patch("threads", thread._id, {
      pinnedAt: pinned ? Date.now() : undefined,
    });
    return null;
  },
});

const newThreadArgs = {
  providerId: v.id("providers"),
  modelId: v.string(),
  effort: v.optional(effortValidator),
};

async function insertThread(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  { providerId, modelId, effort }: ObjectType<typeof newThreadArgs>,
) {
  const provider = await ctx.db.get("providers", providerId);
  if (!provider || provider.ownerId !== ownerId)
    throw new ConvexError("Provider not found");
  if (!provider.models.some((m) => m.id === modelId && !m.hidden))
    throw new ConvexError("Model not available");
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .unique();
  const id = await ctx.db.insert("threads", {
    ownerId,
    title: "New thread",
    providerId,
    modelId,
    systemPromptVersion: CURRENT_SYSTEM_PROMPT_VERSION,
    instructions: settings?.customInstructions,
    startedAt: Date.now(),
    // Only models that take an effort store one (spec phase 4, answer quality ticket 13).
    effort: supportsEffort(provider, modelId)
      ? (effort ?? settings?.defaultEffort ?? defaultEffortFor(modelId))
      : undefined,
  });
  return (await ctx.db.get("threads", id))!;
}

export const createThread = mutation({
  args: newThreadArgs,
  returns: v.id("threads"),
  handler: async (ctx, args) =>
    (await insertThread(ctx, await requireOwner(ctx), args))._id,
});

const messageView = v.object({
  _id: v.id("messages"),
  siblingIds: v.array(v.id("messages")), // this message's versions (itself included), oldest first
  role: v.union(v.literal("user"), v.literal("assistant")),
  pinned: v.boolean(), // never folded into a summary (spec phase 6)
  pinLocked: v.boolean(), // a checkpoint covers it, so its pin can't change
  status: v.union(
    v.literal("streaming"),
    v.literal("waiting"),
    v.literal("done"),
    v.literal("stopped"),
    v.literal("error"),
  ),
  text: v.string(),
  // Replies that called tools: what happened, in order (the text between calls, each call and its
  // result). While the reply runs, text is only the current step's, still streaming.
  items: v.optional(
    v.array(
      v.union(
        v.object({ kind: v.literal("text"), text: v.string() }),
        v.object({
          kind: v.literal("tool"),
          id: v.string(),
          tool: v.string(),
          server: v.union(v.null(), v.string()),
          status: v.union(
            v.literal("running"),
            v.literal("waiting"), // asks for the owner's approval
            v.literal("notRun"), // the reply ended before it ran
            toolStatusValidator,
          ),
          alwaysAllowed: v.boolean(),
          input: v.string(),
          result: v.optional(v.string()),
        }),
      ),
    ),
  ),
  hitStepLimit: v.optional(v.boolean()),
  approvalExpired: v.optional(v.boolean()),
  error: v.optional(v.string()),
  model: v.optional(v.string()),
  modelName: v.optional(v.string()), // the provider's display name for model, when it still lists it
  usage: v.optional(usageValidator),
  costMicroUsd: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  effort: v.optional(effortValidator),
  retryEffort: v.optional(effortValidator), // what "Retry at higher effort" would run at
  images: v.optional(
    v.array(
      v.object({
        url: v.union(v.null(), v.string()),
        width: v.number(),
        height: v.number(),
      }),
    ),
  ),
  documents: v.optional(
    v.array(
      v.object({
        name: v.string(),
        tokens: v.number(),
        fromThreadId: v.optional(v.id("threads")),
      }),
    ),
  ),
  // User messages that searched the web: pending until the search before the reply finishes.
  search: v.optional(
    v.object({
      status: v.union(
        v.literal("pending"),
        v.literal("done"),
        v.literal("failed"),
      ),
      results: v.array(v.object({ title: v.string(), url: v.string() })),
      error: v.optional(v.string()),
      costMicroUsd: v.optional(v.number()),
      queries: v.optional(v.array(v.string())),
      rewriteCostMicroUsd: v.optional(v.number()),
    }),
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
      importedFrom: v.union(v.null(), importSourceValidator), // an imported conversation's source
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
    const servers = new Map(
      (
        await Promise.all(
          [...new Set((thread.toolSet ?? []).map((t) => t.serverId))].map(
            (id) => ctx.db.get("toolServers", id),
          ),
        )
      ).flatMap((s) => (s ? [[s._id, s] as const] : [])),
    );
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
        // Stored content only: a streaming step's text is in streamingText, so a flush
        // doesn't re-run this query (ADR 0004).
        text: m.content,
        items: usedTools(m.parts) ? toolItems(m, thread, servers) : undefined,
        hitStepLimit: m.hitStepLimit,
        approvalExpired: m.approvalExpired,
        error: m.error,
        model: m.model,
        modelName: await modelName(m),
        usage: m.usage,
        costMicroUsd: m.costMicroUsd,
        truncated: m.truncated,
        effort: m.effort,
        // What "Retry at higher effort" would run at; absent when it can't (max, or a model
        // that doesn't take per-message effort).
        retryEffort:
          m.role === "assistant" &&
          m.effort &&
          !isCheaperReply(m, thread) &&
          supportsPerMessageEffort(thread.modelId)
            ? higherEffort(m.effort)
            : undefined,
        images: m.images
          ? await Promise.all(
              m.images.map(async (i) => ({
                url: await ctx.storage.getUrl(i.storageId),
                width: i.width,
                height: i.height,
              })),
            )
          : undefined,
        search: m.search ? await searchView(ctx, m._id) : undefined,
        documents: m.documents?.map(({ name, tokens, fromThreadId }) => ({
          name,
          tokens,
          fromThreadId,
        })),
      })),
    );
    const checkpoint = await latestCheckpoint(
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
      importedFrom: thread.importedFrom?.source ?? null,
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
    };
  },
});

type ReplyItem =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      tool: string;
      server: string | null;
      status: "running" | "waiting" | "notRun" | ToolStatus;
      alwaysAllowed: boolean;
      input: string;
      result?: string;
    };

// A tool-using reply as the thread shows it: its text and each call beside its result.
function toolItems(
  m: Doc<"messages">,
  thread: Doc<"threads">,
  servers: Map<Id<"toolServers">, Doc<"toolServers">>,
) {
  const parts = m.parts ?? [];
  const results = new Map(
    parts.flatMap((p) => (p.type === "toolResult" ? [[p.id, p] as const] : [])),
  );
  const pretty = (json: string) => {
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  };
  return parts.flatMap((p): ReplyItem[] => {
    if (p.type === "text") return p.text ? [{ kind: "text", text: p.text }] : [];
    if (p.type !== "toolCall") return [];
    const frozen = thread.toolSet?.find((t) => t.name === p.name);
    const server = frozen && servers.get(frozen.serverId);
    const result = results.get(p.id);
    return [
      {
        kind: "tool",
        id: p.id,
        tool: frozen?.tool ?? p.name,
        server: server?.name ?? null,
        alwaysAllowed: !!frozen && !!server?.alwaysAllowed.includes(frozen.tool),
        status:
          result?.status ??
          (m.status === "waiting" && m.pendingApproval?.callIds.includes(p.id)
            ? "waiting"
            : m.status === "streaming"
              ? "running"
              : "notRun"),
        input: pretty(p.input),
        result: result?.text,
      },
    ];
  });
}

async function assertNotStreaming(ctx: QueryCtx, thread: Doc<"threads">) {
  const leaf = thread.activeLeafId
    ? await ctx.db.get("messages", thread.activeLeafId)
    : null;
  if (leaf?.status === "streaming" || leaf?.status === "waiting")
    throw new ConvexError("Wait for the reply to finish, or stop it");
}

function cleanText(content: string) {
  const text = content.trim();
  if (!text) throw new ConvexError("Message is empty");
  return text;
}

const searchKeySet = async (ctx: QueryCtx, ownerId: Id<"users">) =>
  !!(
    await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .unique()
  )?.searchKeyEncrypted;

// Documents a send carries: the owner's, extracted and not yet sent. Sending ties each one to
// the thread, so deleting the thread removes it and no other thread can send it.
async function claimDocuments(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  thread: Doc<"threads">,
  ids: Id<"documents">[],
): Promise<DocumentRef[]> {
  if (ids.length > MAX_DOCUMENTS_PER_MESSAGE)
    throw new ConvexError(
      `At most ${MAX_DOCUMENTS_PER_MESSAGE} documents per message`,
    );
  const refs: DocumentRef[] = [];
  for (const id of ids) {
    const doc = await ctx.db.get("documents", id);
    if (!doc || doc.ownerId !== ownerId)
      throw new ConvexError("Document not found");
    if (doc.threadId)
      throw new ConvexError(`${doc.name} was already sent; attach it again`);
    await ctx.db.patch("documents", id, { threadId: thread._id });
    refs.push({
      id,
      name: doc.name,
      tokens: doc.tokens,
      ...(doc.fromThreadId ? { fromThreadId: doc.fromThreadId } : {}),
    });
  }
  return refs;
}

async function searchView(ctx: QueryCtx, messageId: Id<"messages">) {
  const search = await ctx.db
    .query("searches")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .unique();
  if (!search) return { status: "pending" as const, results: [] };
  return {
    status: search.error ? ("failed" as const) : ("done" as const),
    results: search.results.map(({ title, url }) => ({ title, url })),
    ...(search.error ? { error: search.error } : {}),
    ...(search.costMicroUsd !== undefined ? { costMicroUsd: search.costMicroUsd } : {}),
    ...(search.queries ? { queries: search.queries } : {}),
    ...(search.rewriteCostMicroUsd !== undefined ? { rewriteCostMicroUsd: search.rewriteCostMicroUsd } : {}),
  };
}

async function appendUserMessage(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  parent: Doc<"messages"> | null,
  text: string,
  effort?: Effort, // a per-message effort change, made on this message and never changed after
  images?: MessageImage[],
  replyModel?: ReplyModel, // the model answering it, when not the thread's
  search?: boolean,
  documents?: DocumentRef[],
  mode?: OutputMode, // quick stores its brevity line on the message
) {
  if (effort) await assertPerMessageEffort(ctx, thread);
  if (images?.length)
    await assertImagesAllowed(ctx, thread, images, replyModel);
  const id = await insertMessage(
    ctx,
    {
      ownerId: thread.ownerId,
      threadId: thread._id,
      role: "user",
      pinned: false,
      content: text,
      status: "done",
      effort,
      images: images?.length ? images : undefined,
      search: search || undefined,
      documents: documents?.length ? documents : undefined,
      brevity: mode === "quick" ? QUICK_BREVITY : undefined,
    },
    parent ? [...(await ancestorIds(ctx, parent)), parent._id] : [],
  );
  return (await ctx.db.get("messages", id))!;
}

// The effort a request to `modelId` sends (spec phase 4): Anthropic-style models and compatible
// ones the owner flagged as reasoning; threads from before phase 4 run at the default.
export const effortFor = (
  thread: Doc<"threads">,
  provider: Doc<"providers"> | null,
  modelId: string = thread.modelId,
) =>
  supportsEffort(provider, modelId)
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
  modelId: string,
) {
  const base = effortFor(thread, provider, modelId);
  if (!base) return undefined;
  if (user.effort) return user.effort;
  const ancestors = await Promise.all(
    (await ancestorIds(ctx, user)).map((id) => ctx.db.get("messages", id)),
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
  // The thread's tool history can't go to a model that can't call tools (spec phase 10).
  if (thread.toolSet?.length && !supportsTools(provider, model.id))
    throw new ConvexError("This model can't call the tools this thread uses");
  if (!model.vision) {
    const branch = await Promise.all(
      (await ancestorIds(ctx, user)).map((id) => ctx.db.get("messages", id)),
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
  retryEffort?: Effort, // a retry at higher effort: this reply alone runs at it
) {
  await assertWithinBudget(ctx, thread.ownerId);
  const { provider, modelId } = await replyProvider(
    ctx,
    thread,
    user,
    replyModel,
  );
  const assistantId = await insertMessage(
    ctx,
    {
      ownerId: thread.ownerId,
      threadId: thread._id,
      role: "assistant",
      pinned: false,
      content: "",
      status: "streaming",
      model: modelId,
      providerId: provider?._id ?? thread.providerId,
      outputMode,
      effort:
        retryEffort ??
        (await effortInForce(ctx, thread, user, provider, modelId)),
    },
    [...(await ancestorIds(ctx, user)), user._id],
  );
  await createStream(ctx, assistantId);
  // ponytail: first message as title until side-job titles land (ticket 11).
  const title =
    thread.activeLeafId || thread.renamed
      ? thread.title
      : user.content.slice(0, 60);
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

// The first send freezes the thread's tool set (spec phase 10): the exact definitions, with names
// made unique by each server's slug. Later requests send these bytes whatever the servers do.
async function freezeToolSet(
  ctx: MutationCtx,
  thread: Doc<"threads">,
  picks: ToolPick[] | undefined,
) {
  const provider = await ctx.db.get("providers", thread.providerId);
  const capable = supportsTools(provider, thread.modelId);
  if (picks?.length && !capable)
    throw new ConvexError("This model can't call tools");
  const servers = await ctx.db
    .query("toolServers")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", thread.ownerId))
    .take(100);
  const chosen =
    picks ??
    (capable
      ? servers
          .filter((s) => s.onForNewThreads)
          .flatMap((s) => s.tools.map((t) => ({ serverId: s._id, tool: t.name })))
      : []);
  for (const pick of chosen) {
    const server = servers.find((s) => s._id === pick.serverId);
    if (!server?.tools.some((t) => t.name === pick.tool))
      throw new ConvexError("That tool is no longer offered");
  }
  if (chosen.length)
    await ctx.db.patch("threads", thread._id, {
      toolSet: freezeTools(servers, chosen),
    });
}

const sendArgs = {
  content: v.string(),
  mode: v.optional(outputModeValidator),
  effort: v.optional(effortValidator), // change effort from this message on (supported models)
  images: v.optional(v.array(imageValidator)),
  model: v.optional(replyModelValidator), // reply with this model once (spec phase 7)
  search: v.optional(v.boolean()), // search the web for this message before the reply
  documents: v.optional(v.array(v.id("documents"))), // from documents.extract, sent once
  // A thread's first message only: the tools the thread freezes. Absent = every tool of the
  // servers that are on for new threads.
  tools: v.optional(v.array(toolPickValidator)),
};

// A user message and its streaming reply at the end of the thread's active branch.
async function sendTo(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  thread: Doc<"threads">,
  {
    content,
    mode,
    effort,
    images,
    model,
    search,
    documents,
    tools,
  }: ObjectType<typeof sendArgs>,
) {
  const text = cleanText(content);
  await assertNotStreaming(ctx, thread);
  if (effort && model)
    throw new ConvexError(
      "Change effort on a reply from the thread's own model",
    );
  if (search && !(await searchKeySet(ctx, ownerId)))
    throw new ConvexError("Add an Exa API key in Settings to search the web");
  const docs = await claimDocuments(ctx, ownerId, thread, documents ?? []);
  if (!thread.activeLeafId) await freezeToolSet(ctx, thread, tools);
  const parent = thread.activeLeafId
    ? await ctx.db.get("messages", thread.activeLeafId)
    : null;
  await startReply(
    ctx,
    thread,
    await appendUserMessage(
      ctx,
      thread,
      parent,
      text,
      effort,
      images,
      model,
      search,
      docs,
      mode,
    ),
    mode,
    model,
  );
}

export const send = mutation({
  args: { threadId: v.id("threads"), ...sendArgs },
  returns: v.null(),
  handler: async (ctx, { threadId, ...args }) => {
    const ownerId = await requireOwner(ctx);
    await sendTo(ctx, ownerId, await ownedThread(ctx, ownerId, threadId), args);
    return null;
  },
});

// A new thread and its first message in one transaction (spec phase 12): the page opens the
// thread when this returns, and a refused send leaves no empty thread behind. Effort here is
// the thread's level, not a per-message change.
export const startThread = mutation({
  args: { ...newThreadArgs, ...sendArgs },
  returns: v.id("threads"),
  handler: async (ctx, { providerId, modelId, effort, ...args }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await insertThread(ctx, ownerId, {
      providerId,
      modelId,
      effort,
    });
    await sendTo(ctx, ownerId, thread, args);
    return thread._id;
  },
});

// A new reply beside an existing one, under the same user message (ADR 0001: nothing is overwritten).
export const retry = mutation({
  args: {
    messageId: v.id("messages"),
    mode: v.optional(outputModeValidator),
    model: v.optional(replyModelValidator), // retry with this model (spec phase 7)
    higherEffort: v.optional(v.boolean()), // one effort level above this reply's, for the retry alone
  },
  returns: v.null(),
  handler: async (ctx, { messageId, mode, model, higherEffort: higher }) => {
    const ownerId = await requireOwner(ctx);
    const reply = await ownedMessage(ctx, ownerId, messageId);
    if (reply.role !== "assistant" || !reply.parentId)
      throw new ConvexError("Only replies can be retried");
    const thread = await ownedThread(ctx, ownerId, reply.threadId);
    await assertNotStreaming(ctx, thread);
    let retryEffort: Effort | undefined;
    if (higher) {
      if (model)
        throw new ConvexError(
          "Change effort on a reply from the thread's own model",
        );
      await assertPerMessageEffort(ctx, thread);
      retryEffort = reply.effort && higherEffort(reply.effort);
      if (!retryEffort)
        throw new ConvexError("This reply is already at max effort");
    }
    await startReply(
      ctx,
      thread,
      (await ctx.db.get("messages", reply.parentId))!,
      mode,
      model,
      retryEffort,
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
        undefined,
        // A searched message searches again for its new text, while search is still set up.
        original.search && (await searchKeySet(ctx, ownerId)),
        original.documents, // like images, the documents stay
        mode,
      ),
      mode,
    );
    return null;
  },
});

// Makes `messageId`'s branch active, following its newest descendants down to a leaf.
export const switchBranch = mutation({
  args: {
    messageId: v.id("messages"),
    threadId: v.optional(v.id("threads")), // refuse a message from any other thread
  },
  returns: v.null(),
  handler: async (ctx, { messageId, threadId }) => {
    const ownerId = await requireOwner(ctx);
    let leaf = await ownedMessage(ctx, ownerId, messageId);
    if (threadId && leaf.threadId !== threadId)
      throw new ConvexError("Message not found");
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
      !supportsEffort(
        await ctx.db.get("providers", thread.providerId),
        thread.modelId,
      )
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
      await patchThreadState(ctx, threadId, { lastActiveAt: Date.now() });
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
      await deleteStream(ctx, m._id);
      for (const image of m.images ?? [])
        await ctx.storage.delete(image.storageId);
      if (m.search) {
        const search = await ctx.db
          .query("searches")
          .withIndex("by_messageId", (q) => q.eq("messageId", m._id))
          .unique();
        if (search) await ctx.db.delete("searches", search._id);
      }
      const ancestors = await ctx.db
        .query("messageAncestors")
        .withIndex("by_messageId", (q) => q.eq("messageId", m._id))
        .unique();
      if (ancestors) await ctx.db.delete("messageAncestors", ancestors._id);
      await ctx.db.delete("messages", m._id);
    }
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const c of checkpoints) await ctx.db.delete("checkpoints", c._id);
    const state = await threadState(ctx, threadId);
    if (state) await ctx.db.delete("threadStates", state._id);
    const sideJobs = await ctx.db
      .query("sideJobs")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const j of sideJobs) await ctx.db.delete("sideJobs", j._id);
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(PURGE_BATCH);
    for (const d of documents) await ctx.db.delete("documents", d._id);

    const more = [messages, checkpoints, sideJobs, documents].some(
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
    let closed = 0;
    for (const m of stuck) {
      // A reply working through a tool loop is alive while its steps keep starting.
      if ((m.stepStartedAt ?? 0) > Date.now() - STUCK_REPLY_MS) continue;
      await ctx.runMutation(internal.chat.finalize, {
        messageId: m._id,
        status: "error",
        content: (await streamText(ctx, m._id)) ?? "",
        error: "The reply was interrupted",
      });
      closed++;
    }
    // A waiting reply's own expiry job normally ends it; this catches one whose job was lost.
    const waiting = await ctx.db
      .query("messages")
      .withIndex("by_status", (q) => q.eq("status", "waiting"))
      .take(100);
    for (const m of waiting)
      if (
        (m.pendingApproval?.requestedAt ?? 0) <
        Date.now() - APPROVAL_TIMEOUT_MS - 60_000
      ) {
        await stopWaiting(ctx, m);
        closed++;
      }
    return closed;
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
    // Nothing runs while a reply waits for approval, so stopping it ends it here and now.
    if (message.status === "waiting")
      await ctx.db.patch("messages", messageId, {
        status: "stopped",
        pendingApproval: undefined,
        content: joinText(message.parts ?? []),
      });
    return null;
  },
});

// Everything the streaming action needs, including the encrypted key (internal only).
export const generationInput = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({
      stopRequested: v.boolean(),
      queuedAt: v.number(),
      model: v.string(),
      effort: v.optional(effortValidator),
      system: v.string(),
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
      history: v.array(chatMessageValidator),
      layerEnd: v.number(),
      tools: v.optional(v.array(toolDefinitionValidator)),
      cacheTtl: cacheTtlValidator,
      maxTokens: v.number(),
    }),
  ),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming") return null;
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
    const ancestors = await ancestorIds(ctx, message);
    const history = await assembleHistory(ctx, message.threadId, ancestors);
    // A retry at higher effort: its question carries the reply's effort as a per-message change.
    const sent =
      history.messages.findLast((m) => m.effort)?.effort ??
      effortFor(thread, provider, model);
    const retryEffort =
      !oneOff && message.effort && message.effort !== sent
        ? message.effort
        : undefined;
    if (retryEffort) history.messages.at(-1)!.effort = retryEffort;
    return {
      stopRequested: message.stopRequested === true,
      // When this step was queued, for the reply timing log: later steps set stepStartedAt.
      queuedAt: message.stepStartedAt ?? message._creationTime,
      model,
      system: systemPrompt(thread.systemPromptVersion, thread.instructions),
      provider: provider && {
        apiStyle: provider.apiStyle,
        baseUrl: provider.baseUrl,
        apiKeyEncrypted: provider.apiKeyEncrypted,
      },
      allowlist: settings?.allowlistedHosts ?? [],
      // A cheaper reply starts cold, so it sends the level in force once, at the top, rather than
      // per-message changes its model may not accept (spec phase 7).
      // The reply's own earlier steps follow the branch: its tool calls and their results.
      history: [
        ...(oneOff
          ? history.messages.map((m) => ({ ...m, effort: undefined }))
          : history.messages),
        ...(message.parts ? expandParts(message.parts) : []),
      ],
      layerEnd: history.layerEnd,
      // The thread's frozen tools, byte for byte, when the reply's model can call them.
      tools:
        thread.toolSet?.length && supportsTools(provider, model)
          ? thread.toolSet.map(toDefinition)
          : undefined,
      maxTokens: outputCeiling(
        message.outputMode ?? "normal",
        oneOff
          ? message.effort
          : (retryEffort ?? effortFor(thread, provider, model)),
        priceFor(model)?.maxOutput,
      ),
      effort: oneOff ? message.effort : effortFor(thread, provider, model),
      cacheTtl: requestCacheTtl(settings?.keepaliveEnabled, ancestors.length),
    };
  },
});

// A streaming step's text so far, for its owner; null once the step has ended (ADR 0004). The
// thread page watches it only for the branch's last message while it streams.
export const streamingText = query({
  args: { messageId: v.id("messages") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { messageId }) => {
    const ownerId = await requireOwner(ctx);
    await ownedMessage(ctx, ownerId, messageId);
    return await streamText(ctx, messageId);
  },
});

// One flush of a streaming step: appends the text and says whether to stop, in one round trip.
export const flush = internalMutation({
  args: { messageId: v.id("messages"), text: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { messageId, text }) => {
    const message = await ctx.db.get("messages", messageId);
    // No stream row: the step was closed meanwhile (stuck-reply sweep), so the action stops.
    if (!(await appendStream(ctx, messageId, text))) return true;
    return message?.stopRequested === true;
  },
});

export const stopRequested = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, { messageId }) =>
    (await ctx.db.get("messages", messageId))?.stopRequested === true,
});

const thinkingValidator = v.union(
  v.object({
    type: v.literal("thinking"),
    thinking: v.string(),
    signature: v.string(),
  }),
  v.object({ type: v.literal("redactedThinking"), data: v.string() }),
);

// The end of a reply's step (spec phase 10): the usage is metered and added to the reply's steps.
// A step that asked for tools (and has a step, the budget and no stop request left) stores its
// calls and schedules them to run; the reply stays "streaming" and no action runs until then.
// Any other end is the single transition out of "streaming": content is written here once and
// never again. A reply that called no tool is one step and has no parts.
export const finalize = internalMutation({
  args: {
    messageId: v.id("messages"),
    status: v.union(
      v.literal("done"),
      v.literal("stopped"),
      v.literal("error"),
    ),
    content: v.string(), // this step's text
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
    thinking: v.optional(v.array(thinkingValidator)), // this step's thinking blocks
    toolCalls: v.optional(
      v.array(
        v.object({ id: v.string(), name: v.string(), input: v.string() }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      messageId,
      status,
      content,
      error,
      usage,
      reports,
      reportedCostMicroUsd,
      cacheRequest,
      truncated,
      thinking,
      toolCalls,
    },
  ) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming") return null;
    const step = nextStep(message.parts);
    const thread = await ctx.db.get("threads", message.threadId);

    // Does the reply go on? Only a finished step that asked for tools can.
    let calls = status === "done" ? (toolCalls ?? []) : [];
    let end = { status, error, truncated, hitStepLimit: undefined as boolean | undefined };
    if (calls.length) {
      const settings = await ctx.db
        .query("settings")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
        .unique();
      if (message.stopRequested) {
        end = { ...end, status: "stopped" };
        calls = [];
      } else if (step >= MAX_STEPS) {
        // Step ten asked for more: finish as truncated; Continue asks again.
        end = { ...end, truncated: true, hitStepLimit: true };
        calls = [];
      } else if (await budgetReached(ctx, settings, Date.now())) {
        end = { ...end, status: "error", error: BUDGET_REACHED };
        calls = [];
      }
    }
    const loop = calls.length > 0;

    const stepParts: Part[] = [
      ...(thinking ?? []).map((t) => ({ ...t, step })),
      ...(content ? [{ type: "text" as const, step, text: content }] : []),
      ...calls.map((c) => ({ type: "toolCall" as const, step, ...c })),
    ];
    const withTools = usedTools(message.parts) || loop;
    const parts = withTools ? [...(message.parts ?? []), ...stepParts] : undefined;

    // The step's text moves onto the message (content, or parts when the reply goes on) in this
    // same transaction, so no moment shows it twice or not at all.
    await deleteStream(ctx, messageId);

    // A step is metered as it finishes; the reply's usage and cost are the sum of its steps.
    let metered: Partial<Doc<"messages">> = {};
    if (usage) {
      const cost = await meterCall(ctx, {
        ownerId: message.ownerId,
        threadId: message.threadId,
        providerId: message.providerId,
        model: message.model ?? "",
        normalized: { usage, reports, reportedCostMicroUsd },
      });
      const steps = [
        ...(message.steps ?? []),
        { usage, costMicroUsd: cost ?? undefined },
      ];
      metered = {
        usage: sumUsage(steps.map((s) => s.usage)),
        costMicroUsd: sumCost(steps.map((s) => s.costMicroUsd)),
        steps,
      };
    }

    if (loop) {
      // Calls to tools that aren't always allowed wait for the owner, all of the step together.
      const approval = thread && (await needsApproval(ctx, thread, calls));
      await ctx.db.patch("messages", messageId, {
        ...metered,
        parts,
        ...(approval
          ? {
              status: "waiting" as const,
              pendingApproval: {
                step,
                callIds: calls.map((c) => c.id),
                requestedAt: Date.now(),
              },
            }
          : {}),
      });
      if (approval)
        await ctx.scheduler.runAfter(
          APPROVAL_TIMEOUT_MS,
          internal.chat.expireApproval,
          { messageId, step },
        );
      else
        await ctx.scheduler.runAfter(0, internal.chatActions.runTools, {
          messageId,
          step,
          declined: [],
        });
    } else {
      await ctx.db.patch("messages", messageId, {
        ...metered,
        status: end.status,
        content: parts ? joinText(parts) : content,
        error: end.error,
        truncated: end.truncated,
        hitStepLimit: end.hitStepLimit,
        parts,
      });
    }

    // A cheaper reply's cache belongs to another model: the thread's touch and keepalive stay.
    if (usage && thread && !isCheaperReply(message, thread)) {
      // A cache-marked request that the provider says read or wrote the cache touched it.
      const touchedAt =
        cacheRequest && touchedCache(usage) ? cacheRequest.startedAt : null;
      if (touchedAt !== null)
        await patchThreadState(ctx, thread._id, {
          cacheTouchedAt: touchedAt,
          cacheTtl: cacheRequest!.ttl,
        });
      await restartKeepalive(ctx, thread, touchedAt);
    }

    // The first successful reply in a thread gets a side-job title, once (from the thread's
    // first message, so a failed first reply doesn't leave the thread untitled).
    if (!loop && usage && end.status === "done" && thread && !thread.titleRequested) {
      await ctx.db.patch("threads", thread._id, { titleRequested: true });
      await ctx.scheduler.runAfter(0, internal.chatActions.generateTitle, {
        threadId: thread._id,
        replyId: messageId,
      });
    }
    // A finished reply may have grown the thread past the condense threshold (spec phase 6).
    if (!loop && end.status === "done" && thread) await scheduleCondense(ctx, thread);
    return null;
  },
});

// Whether a step's calls need the owner's say: any call to a tool of the thread that isn't always
// allowed. A call to a tool the thread never had can't run, so it asks for nothing.
async function needsApproval(
  ctx: QueryCtx,
  thread: Doc<"threads">,
  calls: { name: string }[],
) {
  for (const call of calls) {
    const frozen = thread.toolSet?.find((t) => t.name === call.name);
    if (!frozen) continue;
    const server = await ctx.db.get("toolServers", frozen.serverId);
    if (!server?.alwaysAllowed.includes(frozen.tool)) return true;
  }
  return false;
}

// The owner's answer to a step's approval prompt: every call runs except the ones declined,
// which tell the model so. The reply goes back to running.
export const approveTools = mutation({
  args: { messageId: v.id("messages"), declined: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { messageId, declined }) => {
    const ownerId = await requireOwner(ctx);
    const message = await ownedMessage(ctx, ownerId, messageId);
    const pending = message.pendingApproval;
    if (message.status !== "waiting" || !pending)
      throw new ConvexError("Nothing is waiting for approval");
    if (declined.some((id) => !pending.callIds.includes(id)))
      throw new ConvexError("That call isn't waiting for approval");
    await ctx.db.patch("messages", messageId, {
      status: "streaming",
      pendingApproval: undefined,
      stepStartedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.chatActions.runTools, {
      messageId,
      step: pending.step,
      declined,
    });
    return null;
  },
});

// A reply that waited 30 minutes for approval stops, with Continue to ask again. Scheduled when it
// starts waiting; a no-op if the owner answered or stopped it since.
async function stopWaiting(ctx: MutationCtx, message: Doc<"messages">) {
  await ctx.db.patch("messages", message._id, {
    status: "stopped",
    truncated: true,
    approvalExpired: true,
    pendingApproval: undefined,
    content: joinText(message.parts ?? []),
  });
}
export const expireApproval = internalMutation({
  args: { messageId: v.id("messages"), step: v.number() },
  returns: v.null(),
  handler: async (ctx, { messageId, step }) => {
    const message = await ctx.db.get("messages", messageId);
    if (message?.status === "waiting" && message.pendingApproval?.step === step)
      await stopWaiting(ctx, message);
    return null;
  },
});

// What runTools needs for the calls of one step: each call with its server, and why it can't run
// if it can't (a tool the thread never had, a removed server,
// a tool the server stopped offering). null once the reply is closed or being stopped.
export const toolRunInput = internalQuery({
  args: { messageId: v.id("messages"), step: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      allowlist: v.array(v.string()),
      calls: v.array(
        v.object({
          id: v.string(),
          input: v.string(),
          tool: v.optional(v.string()), // the server's own name for it
          url: v.optional(v.string()),
          headersEncrypted: v.optional(v.string()),
          problem: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, { messageId, step }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message || message.status !== "streaming" || message.stopRequested)
      return null;
    const thread = await ctx.db.get("threads", message.threadId);
    if (!thread) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
      .unique();
    const calls = [];
    for (const part of message.parts ?? []) {
      if (part.type !== "toolCall" || part.step !== step) continue;
      const frozen = thread.toolSet?.find((t) => t.name === part.name);
      const server = frozen && (await ctx.db.get("toolServers", frozen.serverId));
      const offered = !!frozen && !!server?.tools.some((t) => t.name === frozen.tool);
      calls.push({
        id: part.id,
        input: part.input,
        tool: frozen?.tool,
        url: server?.url,
        headersEncrypted: server?.headersEncrypted,
        problem: !frozen
          ? `this thread has no tool called ${part.name}`
          : !server
            ? "the tool server was removed"
            : !offered
              ? "the server no longer offers this tool"
              : undefined,
      });
    }
    return { allowlist: settings?.allowlistedHosts ?? [], calls };
  },
});

// The calls of a step have run: their results join the reply's parts and the next step starts,
// unless the reply was stopped or the daily budget is reached (checked before every step).
export const finishTools = internalMutation({
  args: {
    messageId: v.id("messages"),
    step: v.number(),
    results: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        status: toolStatusValidator,
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, step, results }) => {
    const message = await ctx.db.get("messages", messageId);
    const done = (message?.parts ?? []).some(
      (p) => p.type === "toolResult" && p.step === step,
    );
    if (!message || message.status !== "streaming" || done) return null;
    // A stopped reply keeps no results: its calls then count as never made.
    if (message.stopRequested) {
      await ctx.db.patch("messages", messageId, {
        status: "stopped",
        content: joinText(message.parts ?? []),
      });
      return null;
    }
    const parts: Part[] = [
      ...(message.parts ?? []),
      ...results.map((r) => ({ type: "toolResult" as const, step, ...r })),
    ];
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", message.ownerId))
      .unique();
    if (await budgetReached(ctx, settings, Date.now())) {
      await ctx.db.patch("messages", messageId, {
        status: "error",
        error: BUDGET_REACHED,
        content: joinText(parts),
        parts,
      });
      return null;
    }
    await ctx.db.patch("messages", messageId, {
      parts,
      stepStartedAt: Date.now(),
    });
    await createStream(ctx, messageId);
    await ctx.scheduler.runAfter(0, internal.chatActions.generate, {
      messageId,
    });
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
    const firstId = reply && (await ancestorIds(ctx, reply))[0];
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
    if (title && !thread.renamed)
      await ctx.db.patch("threads", threadId, { title });
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
