import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ChatMessage } from "./anthropic";

// Prefix for the summary message. Changing it changes every request's bytes after the
// system prompt, so treat it like a system prompt: version it if it ever changes.
export const SUMMARY_PREFIX = "Summary of the earlier conversation:\n\n";

// The history sent for a branch (the given messages, root first), with the latest checkpoint on that
// branch standing in for everything it covers (design doc S1, S5). Pinned messages inside
// the covered range follow the summary verbatim, in their original order. The summary goes
// in the messages, never the system prompt, so system bytes depend on the version alone.
// layerEnd counts the leading messages that form the checkpoint layer (summary plus covered
// pins): 0 without a checkpoint. The Anthropic adapter puts a cache breakpoint at its end.
export async function assembleHistory(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  branchIds: Id<"messages">[],
): Promise<{
  messages: ChatMessage[];
  layerEnd: number;
  checkpoint: Doc<"checkpoints"> | null;
}> {
  const branch = (
    await Promise.all(branchIds.map((id) => ctx.db.get("messages", id)))
  ).filter((m): m is Doc<"messages"> => m !== null);
  const position = new Map(branch.map((m, i) => [m._id, i]));
  // ponytail: reads up to 100 checkpoints per thread; a condenser that rolls them keeps it far below that.
  const onBranch = (
    await ctx.db
      .query("checkpoints")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(100)
  ).filter((c) => position.has(c.coversUpToId));
  // Checkpoints roll, so the one covering the most of this branch is the latest. A fork made
  // before a checkpoint doesn't contain its coversUpToId, so it never sees it.
  const latest = onBranch.sort(
    (a, b) => position.get(b.coversUpToId)! - position.get(a.coversUpToId)!,
  )[0];

  // Per-message effort and images ride along on user messages; the adapter turns them into
  // their own blocks, so request bytes depend only on stored data.
  const toChat = (m: Doc<"messages">): ChatMessage => ({
    role: m.role,
    content: m.content,
    ...(m.role === "user" && m.effort ? { effort: m.effort } : {}),
    ...(m.role === "user" && m.images?.length ? { images: m.images } : {}),
  });
  const verbatim = (ms: Doc<"messages">[]) =>
    ms.filter((m) => m.content !== "").map(toChat);
  if (!latest)
    return { messages: verbatim(branch), layerEnd: 0, checkpoint: null };
  const cut = position.get(latest.coversUpToId)! + 1;
  const layer: ChatMessage[] = [
    { role: "user", content: SUMMARY_PREFIX + latest.summary },
    ...verbatim(branch.slice(0, cut).filter((m) => m.pinned)),
  ];
  return {
    messages: [...layer, ...verbatim(branch.slice(cut))],
    layerEnd: layer.length,
    checkpoint: latest,
  };
}
