import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { ancestorIds, insertMessage } from "./lib/ancestors";
import { DEFAULT_EFFORT } from "./lib/effort";
import { CURRENT_SYSTEM_PROMPT_VERSION } from "./lib/systemPrompts";
import { requireOwner } from "./owner";
import { importSourceValidator } from "./schema";

// Import (spec phase 7): the browser uploads a ChatGPT or Claude conversations.json, start()
// records it and schedules importActions.run, which parses it and writes each conversation as a
// thread through writeChunk. Imported messages carry no usage, so they never reach rollups,
// budgets or spend, and their threads never get a side-job title.

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireOwner(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const start = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    providerId: v.id("providers"),
    modelId: v.string(),
  },
  returns: v.id("imports"),
  handler: async (ctx, { storageId, fileName, providerId, modelId }) => {
    const ownerId = await requireOwner(ctx);
    const provider = await ctx.db.get("providers", providerId);
    if (!provider || provider.ownerId !== ownerId)
      throw new ConvexError("Provider not found");
    if (!provider.models.some((m) => m.id === modelId && !m.hidden))
      throw new ConvexError("Model not available");
    const importId = await ctx.db.insert("imports", {
      ownerId,
      fileName: fileName.slice(0, 200),
      storageId,
      providerId,
      modelId,
      status: "queued",
      imported: 0,
      skipped: 0,
    });
    await ctx.scheduler.runAfter(0, internal.importActions.run, {
      importId,
      from: 0,
    });
    return importId;
  },
});

// The owner's 20 latest imports, newest first.
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("imports"),
      _creationTime: v.number(),
      fileName: v.string(),
      source: v.optional(importSourceValidator),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed"),
      ),
      total: v.optional(v.number()),
      imported: v.number(),
      skipped: v.number(),
      error: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db
      .query("imports")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(20);
    return rows.map(
      ({
        _id,
        _creationTime,
        fileName,
        source,
        status,
        total,
        imported,
        skipped,
        error,
      }) => ({
        _id,
        _creationTime,
        fileName,
        source,
        status,
        total,
        imported,
        skipped,
        error,
      }),
    );
  },
});

export const get = internalQuery({
  args: { importId: v.id("imports") },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.optional(v.id("_storage")), status: v.string() }),
  ),
  handler: async (ctx, { importId }) => {
    const row = await ctx.db.get("imports", importId);
    return row && { storageId: row.storageId, status: row.status };
  },
});

// The file parsed: what it is and how many conversations it holds.
export const begin = internalMutation({
  args: {
    importId: v.id("imports"),
    source: importSourceValidator,
    total: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { importId, source, total }) => {
    await ctx.db.patch("imports", importId, {
      source,
      total,
      status: "running",
    });
    return null;
  },
});

// Ends an import: done, or failed with a reason. The uploaded file goes either way.
export const finish = internalMutation({
  args: { importId: v.id("imports"), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { importId, error }) => {
    const row = await ctx.db.get("imports", importId);
    if (!row) return null;
    if (row.storageId) await ctx.storage.delete(row.storageId);
    await ctx.db.patch("imports", importId, {
      storageId: undefined,
      status: error ? "failed" : "done",
      error,
    });
    return null;
  },
});

const messageInput = v.object({
  key: v.string(),
  parentKey: v.optional(v.string()),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  model: v.optional(v.string()),
});

// Writes one conversation, or one chunk of a long one, root first. The first chunk creates the
// thread (or reports the conversation as already imported); later chunks pass the thread back
// with the ids of earlier messages they hang from. The last chunk sets the active leaf and
// counts the conversation. Returns the ids it wrote by key.
export const writeChunk = internalMutation({
  args: {
    importId: v.id("imports"),
    conversation: v.object({
      externalId: v.string(),
      title: v.string(),
      startedAt: v.number(),
    }),
    threadId: v.optional(v.id("threads")), // later chunks
    messages: v.array(messageInput),
    parents: v.record(v.string(), v.id("messages")), // earlier chunks' messages this one hangs from
    activeKey: v.optional(v.string()),
    last: v.boolean(),
  },
  returns: v.union(
    v.object({ skipped: v.literal(true) }),
    v.object({
      skipped: v.literal(false),
      threadId: v.id("threads"),
      ids: v.record(v.string(), v.id("messages")),
    }),
  ),
  handler: async (ctx, args) => {
    const job = (await ctx.db.get("imports", args.importId))!;
    let threadId = args.threadId;
    if (!threadId) {
      const existing = await ctx.db
        .query("threads")
        .withIndex("by_ownerId_and_importedFrom", (q) =>
          q
            .eq("ownerId", job.ownerId)
            .eq("importedFrom.source", job.source)
            .eq("importedFrom.externalId", args.conversation.externalId),
        )
        .first();
      if (existing) {
        await ctx.db.patch("imports", args.importId, {
          skipped: job.skipped + 1,
        });
        return { skipped: true as const };
      }
      const provider = await ctx.db.get("providers", job.providerId);
      const settings = await ctx.db
        .query("settings")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", job.ownerId))
        .unique();
      threadId = await ctx.db.insert("threads", {
        ownerId: job.ownerId,
        title: args.conversation.title.slice(0, 200),
        providerId: job.providerId,
        modelId: job.modelId,
        systemPromptVersion: CURRENT_SYSTEM_PROMPT_VERSION,
        instructions: settings?.customInstructions,
        startedAt: args.conversation.startedAt,
        importedFrom: {
          source: job.source!,
          externalId: args.conversation.externalId,
        },
        titleRequested: true, // importing never spends money on a title
        effort: provider?.apiStyle === "anthropic" ? DEFAULT_EFFORT : undefined,
      });
    }

    // Each written message's path: its ancestors, root first, then itself.
    const written = new Map<string, Id<"messages">[]>();
    const pathOf = async (key: string | undefined) => {
      if (key === undefined) return [];
      const here = written.get(key);
      if (here) return here;
      const id = args.parents[key] as Id<"messages"> | undefined;
      const message = id && (await ctx.db.get("messages", id));
      return message ? [...(await ancestorIds(ctx, message)), message._id] : [];
    };
    for (const m of args.messages) {
      const ancestors = await pathOf(m.parentKey);
      const id = await insertMessage(
        ctx,
        {
          ownerId: job.ownerId,
          threadId,
          role: m.role,
          pinned: false,
          content: m.content,
          status: "done",
          model: m.model,
        },
        ancestors,
      );
      written.set(m.key, [...ancestors, id]);
    }
    if (args.last) {
      const leaf = args.activeKey ? (await pathOf(args.activeKey)).at(-1) : undefined;
      await ctx.db.patch("threads", threadId, { activeLeafId: leaf });
      await ctx.db.patch("imports", args.importId, {
        imported: job.imported + 1,
      });
    }
    return {
      skipped: false as const,
      threadId,
      ids: Object.fromEntries([...written].map(([k, path]) => [k, path.at(-1)!])),
    };
  },
});
