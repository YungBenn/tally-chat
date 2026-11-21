import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// A streaming reply's text lives in its own `streams` row until the step ends (ADR 0004), so a
// flush touches only that row: the thread query never reads it and doesn't re-run. The row is
// created with each step and deleted by chat.finalize in the transaction that writes the text
// onto the message.
const row = (ctx: QueryCtx, messageId: Id<"messages">) =>
  ctx.db
    .query("streams")
    .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
    .unique();

export const createStream = (ctx: MutationCtx, messageId: Id<"messages">) =>
  ctx.db.insert("streams", { messageId, text: "" });

// The text so far, or null when no step is streaming.
export const streamText = async (ctx: QueryCtx, messageId: Id<"messages">) =>
  (await row(ctx, messageId))?.text ?? null;

export async function appendStream(ctx: MutationCtx, messageId: Id<"messages">, text: string) {
  const stream = await row(ctx, messageId);
  if (stream) await ctx.db.patch("streams", stream._id, { text: stream.text + text });
  return stream !== null;
}

export async function deleteStream(ctx: MutationCtx, messageId: Id<"messages">) {
  const stream = await row(ctx, messageId);
  if (stream) await ctx.db.delete("streams", stream._id);
}
