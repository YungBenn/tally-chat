import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { threadRow, toRow } from "./chat";
import { snippet } from "./lib/search";
import { requireOwner } from "./owner";

const TITLE_HITS = 20;
const MESSAGE_HITS = 30;

// The sidebar search (spec phases 4 and 7): threads whose title matches, best first, then
// messages whose text does, each with its thread and the text around the match. The client
// calls it as a one-off request, never a subscription, so search-index changes can't make
// every open client re-run it (design doc section 10, the T3 Chat outage).
export const search = query({
  args: { query: v.string() },
  returns: v.object({
    titles: v.array(threadRow),
    messages: v.array(
      v.object({
        messageId: v.id("messages"),
        threadId: v.id("threads"),
        threadTitle: v.string(),
        role: v.union(v.literal("user"), v.literal("assistant")),
        snippet: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwner(ctx);
    const text = args.query.trim();
    if (!text) return { titles: [], messages: [] };
    const titles = await ctx.db
      .query("threads")
      .withSearchIndex("search_title", (q) =>
        q.search("title", text).eq("ownerId", ownerId),
      )
      .take(TITLE_HITS);
    // A few extra, since streaming replies and messages of just-deleted threads are dropped.
    const found = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (q) =>
        q.search("content", text).eq("ownerId", ownerId),
      )
      .take(MESSAGE_HITS + 10);
    const threads = new Map<Id<"threads">, Promise<{ title: string } | null>>();
    const threadOf = (id: Id<"threads">) => {
      if (!threads.has(id)) threads.set(id, ctx.db.get("threads", id));
      return threads.get(id)!;
    };
    const messages = [];
    for (const m of found) {
      if (m.status === "streaming") continue;
      const thread = await threadOf(m.threadId);
      if (!thread) continue; // deleted; its messages are being purged
      messages.push({
        messageId: m._id,
        threadId: m.threadId,
        threadTitle: thread.title,
        role: m.role,
        snippet: snippet(m.content, text),
      });
      if (messages.length === MESSAGE_HITS) break;
    }
    return { titles: titles.map(toRow), messages };
  },
});
