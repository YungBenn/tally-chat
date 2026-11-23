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
      // The Exa key's ciphertext; null: the key was removed after the message.
      keyEncrypted: v.union(v.null(), v.string()),
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
    return {
      messageId: user._id,
      query: searchQuery(user.content),
      keyEncrypted: settings?.searchKeyEncrypted ?? null,
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
