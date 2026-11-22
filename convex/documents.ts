import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { activeBranch } from "./chat";
import { estimateTokens } from "./inspector";
import { latestCheckpoint } from "./lib/context";
import { MAX_DOCUMENT_TOKENS, threadTranscript } from "./lib/documents";
import { requireOwner } from "./owner";

export const save = internalMutation({
  args: {
    ownerId: v.id("users"),
    name: v.string(),
    text: v.string(),
    tokens: v.number(),
  },
  returns: v.id("documents"),
  handler: (ctx, args) => ctx.db.insert("documents", args),
});

// Documents attached in a composer but never sent: removed a day later.
export const sweepUnsent = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("documents")
      .withIndex("by_threadId", (q) =>
        q.eq("threadId", undefined).lt("_creationTime", Date.now() - 24 * 60 * 60 * 1000),
      )
      .take(100);
    for (const d of stale) await ctx.db.delete("documents", d._id);
    return null;
  },
});

// Mentioning a thread (drag it in, or @): a copy of its active branch as a document, frozen now
// so the message that sends it keeps the same bytes. Past the limit, its latest condense
// summary stands in for the turns it covers.
export const fromThread = mutation({
  args: { threadId: v.id("threads") },
  returns: v.object({ documentId: v.id("documents"), name: v.string(), tokens: v.number() }),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) throw new ConvexError("Thread not found");
    const branch = (await activeBranch(ctx, thread)).filter(
      (m) => m.status !== "streaming" && m.content !== "",
    );
    if (branch.length === 0) throw new ConvexError(`${thread.title} has no messages yet`);
    const turns = (ms: typeof branch) =>
      ms.map((m) => ({
        role: m.role,
        content: m.content,
        model: m.model,
        attachments: [...(m.images ?? []).map(() => "image"), ...(m.documents ?? []).map((d) => d.name)],
      }));
    const startedAt = thread.startedAt ?? thread._creationTime;
    let text = threadTranscript(thread.title, startedAt, turns(branch));
    let tokens = estimateTokens(text);
    if (tokens > MAX_DOCUMENT_TOKENS) {
      const checkpoint = await latestCheckpoint(ctx, thread._id, branch.map((m) => m._id));
      const cut = checkpoint ? branch.findIndex((m) => m._id === checkpoint.coversUpToId) + 1 : 0;
      if (checkpoint && cut > 0) {
        text = threadTranscript(thread.title, startedAt, turns(branch.slice(cut)), checkpoint.summary);
        tokens = estimateTokens(text);
      }
    }
    if (tokens > MAX_DOCUMENT_TOKENS)
      throw new ConvexError(
        `${thread.title} is about ${Math.round(tokens / 1000)}k tokens; the limit is ${MAX_DOCUMENT_TOKENS / 1000}k. Condense it first.`,
      );
    const name = thread.title;
    const documentId = await ctx.db.insert("documents", { ownerId, name, text, tokens, fromThreadId: thread._id });
    return { documentId, name, tokens };
  },
});
