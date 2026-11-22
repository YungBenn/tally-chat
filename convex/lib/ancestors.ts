import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// A message's ancestors, root..parent (ADR 0001). They live in their own messageAncestors row:
// on the message itself, every read of a branch carried each message's whole path, O(n²) bytes,
// and a thread of about 650 messages hit Convex's 16 MiB read limit.
export async function ancestorIds(
  ctx: QueryCtx,
  message: Doc<"messages">,
): Promise<Id<"messages">[]> {
  const row = await ctx.db
    .query("messageAncestors")
    .withIndex("by_messageId", (q) => q.eq("messageId", message._id))
    .unique();
  // A message from before phase 12 keeps them inline until migrations:moveMessageAncestors runs.
  return row?.ancestorIds ?? message.ancestorIds ?? [];
}

// Inserts a message under the last of `ancestors` (root..parent; empty for a root) with its
// ancestors row.
export async function insertMessage(
  ctx: MutationCtx,
  fields: Omit<WithoutSystemFields<Doc<"messages">>, "parentId" | "ancestorIds">,
  ancestors: Id<"messages">[],
): Promise<Id<"messages">> {
  const messageId = await ctx.db.insert("messages", {
    ...fields,
    parentId: ancestors.at(-1),
  });
  await ctx.db.insert("messageAncestors", { messageId, ancestorIds: ancestors });
  return messageId;
}
