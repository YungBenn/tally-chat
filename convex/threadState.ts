import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { cacheExpiresAt } from "./lib/cacheStatus";
import { requireOwner } from "./owner";

// A thread's presence and cache bookkeeping (schema threadStates, spec phase 12). Only the
// functions that need it read it, so its every-minute writes re-run nothing else.

type Fields = Partial<Omit<Doc<"threadStates">, "_id" | "_creationTime" | "threadId">>;

export function threadState(ctx: QueryCtx, threadId: Id<"threads">) {
  return ctx.db
    .query("threadStates")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
}

// Sets fields on the thread's state row, making it on first write; undefined clears a field.
export async function patchThreadState(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  fields: Fields,
) {
  const row = await threadState(ctx, threadId);
  if (row) await ctx.db.patch("threadStates", row._id, fields);
  else await ctx.db.insert("threadStates", { threadId, ...fields });
}

// Whether this thread has a keepalive job still waiting to run.
export async function keepalivePending(
  ctx: QueryCtx,
  state: Doc<"threadStates"> | null,
) {
  if (!state?.keepaliveJobId) return false;
  const job = await ctx.db.system.get("_scheduled_functions", state.keepaliveJobId);
  return job?.state.kind === "pending";
}

// The cache pill's inputs, for the client to judge against its clock with lib/cacheStatus
// (queries can't read the clock). Null for a missing or foreign thread.
export const cache = query({
  args: { threadId: v.id("threads") },
  returns: v.union(
    v.null(),
    v.object({
      expiresAt: v.union(v.null(), v.number()),
      keepaliveScheduled: v.boolean(),
      lastActiveAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const ownerId = await requireOwner(ctx);
    const thread = await ctx.db.get("threads", threadId);
    if (!thread || thread.ownerId !== ownerId) return null;
    const state = await threadState(ctx, threadId);
    return {
      expiresAt: cacheExpiresAt(state ?? {}),
      keepaliveScheduled: await keepalivePending(ctx, state),
      lastActiveAt: state?.lastActiveAt ?? null,
    };
  },
});
