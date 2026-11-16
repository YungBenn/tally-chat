import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { searchQuery, searchResultValidator } from "./lib/webSearch";

// The search a reply waits for: its user message asked to search and has no stored search yet.
// A retry or a later turn finds the stored one, so each message is searched once.
export const pending = internalQuery({
  args: { replyId: v.id("messages") },
  returns: v.union(
    v.null(),
    v.object({
      messageId: v.id("messages"),
      query: v.string(),
      url: v.union(v.null(), v.string()), // null: search was turned off after the message
      allowlist: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { replyId }) => {
    const reply = await ctx.db.get("messages", replyId);
    const user = reply?.parentId
      ? await ctx.db.get("messages", reply.parentId)
      : null;
    if (!user?.search) return null;
    const done = await ctx.db
      .query("searches")
      .withIndex("by_messageId", (q) => q.eq("messageId", user._id))
      .unique();
    if (done) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", user.ownerId))
      .unique();
    const url = settings?.searchUrl ?? null;
    return {
      messageId: user._id,
      query: searchQuery(user.content),
      url,
      // The owner named this host, so it is trusted like an allowlisted one.
      allowlist: [
        ...(settings?.allowlistedHosts ?? []),
        ...(url ? [new URL(url).host] : []),
      ],
    };
  },
});

export const save = internalMutation({
  args: {
    messageId: v.id("messages"),
    query: v.string(),
    results: v.array(searchResultValidator),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { messageId, ...search }) => {
    const message = await ctx.db.get("messages", messageId);
    if (!message) return null;
    const existing = await ctx.db
      .query("searches")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique();
    if (!existing)
      await ctx.db.insert("searches", {
        ownerId: message.ownerId,
        messageId,
        ...search,
      });
    return null;
  },
});
