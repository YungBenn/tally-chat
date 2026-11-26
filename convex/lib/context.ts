import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ChatMessage } from "./anthropic";
import { documentBlock } from "./documents";
import { expandParts, usedTools } from "./toolParts";
import { searchBlock } from "./webSearch";

// Prefix for the summary message. Changing it changes every request's bytes after the
// system prompt, so treat it like a system prompt: version it if it ever changes.
export const SUMMARY_PREFIX = "Summary of the earlier conversation:\n\n";
const summaryText = (c: { summary: string; promptVersion?: number }) =>
  SUMMARY_PREFIX +
  ((c.promptVersion ?? 1) >= 2 ? `<summary>\n${c.summary}\n</summary>` : c.summary);

// The latest checkpoint on a branch (message ids, root first), or null. Checkpoints roll, so the
// one covering the most of the branch is the latest. A fork made before a checkpoint doesn't
// contain its coversUpToId, so it never sees it.
export async function latestCheckpoint(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  branchIds: Id<"messages">[],
): Promise<Doc<"checkpoints"> | null> {
  const position = new Map(branchIds.map((id, i) => [id, i]));
  // ponytail: reads up to 100 checkpoints per thread; a condenser that rolls them keeps it far below that.
  const onBranch = (
    await ctx.db
      .query("checkpoints")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(100)
  ).filter((c) => position.has(c.coversUpToId));
  return (
    onBranch.sort(
      (a, b) => position.get(b.coversUpToId)! - position.get(a.coversUpToId)!,
    )[0] ?? null
  );
}

// The history sent for a branch (the given messages, root first), with the latest checkpoint on that
// branch standing in for everything it covers (design doc S1, S5). Pinned messages inside
// the covered range follow the summary verbatim, in their original order. The summary goes
// in the messages, never the system prompt, so system bytes depend on the version and the
// thread's own instructions alone.
// layerEnd counts the leading messages that form the checkpoint layer (summary plus covered
// pins): 0 without a checkpoint. The Anthropic adapter puts a cache breakpoint at its end.
export type History = {
  messages: ChatMessage[];
  layerEnd: number;
  checkpoint: Doc<"checkpoints"> | null;
};
export async function assembleHistory(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  branchIds: Id<"messages">[],
): Promise<History> {
  const branch = (
    await Promise.all(branchIds.map((id) => ctx.db.get("messages", id)))
  ).filter((m): m is Doc<"messages"> => m !== null);
  const position = new Map(branch.map((m, i) => [m._id, i]));
  const latest = await latestCheckpoint(ctx, threadId, branchIds);

  // A searched message carries its stored results after its text (lib/webSearch), the same
  // bytes on every request. ponytail: kept whole on later turns rather than digested; at about
  // 1k tokens of snippets that mostly costs cache reads. Digest when results grow (page text).
  const searches = new Map(
    await Promise.all(
      branch
        .filter((m) => m.search)
        .map(
          async (m) =>
            [
              m._id,
              await ctx.db
                .query("searches")
                .withIndex("by_messageId", (q) => q.eq("messageId", m._id))
                .unique(),
            ] as const,
        ),
    ),
  );

  // Documents go before the message text, whole (lib/documents), in the order they were sent.
  const documents = new Map(
    await Promise.all(
      branch
        .flatMap((m) => m.documents ?? [])
        .map(async (ref) => [ref.id, await ctx.db.get("documents", ref.id)] as const),
    ),
  );
  const withAttachments = (m: Doc<"messages">) =>
    [
      ...(m.documents ?? []).flatMap((ref) => {
        const doc = documents.get(ref.id);
        return doc ? [documentBlock(doc.name, doc.text)] : [];
      }),
      m.content,
      ...(searches.get(m._id) ? [searchBlock(searches.get(m._id)!)] : []),
    ].join("\n\n");

  // Per-message effort and images ride along on user messages; the adapter turns them into
  // their own blocks, so request bytes depend only on stored data.
  const toChat = (m: Doc<"messages">): ChatMessage[] =>
    // A reply that used tools goes back as its steps, results word for word (ADR 0003).
    m.role === "assistant" && usedTools(m.parts)
      ? expandParts(m.parts!)
      : [
          {
            role: m.role,
            content: withAttachments(m),
            ...(m.role === "user" && m.effort ? { effort: m.effort } : {}),
            ...(m.role === "user" && m.images?.length ? { images: m.images } : {}),
          },
        ];
  const verbatim = (ms: Doc<"messages">[]) =>
    // A reply still running a tool loop has no content yet, but its stored steps count.
    ms.filter((m) => m.content !== "" || usedTools(m.parts)).flatMap(toChat);
  if (!latest)
    return { messages: verbatim(branch), layerEnd: 0, checkpoint: null };
  const cut = position.get(latest.coversUpToId)! + 1;
  const layer: ChatMessage[] = [
    { role: "user", content: summaryText(latest) },
    ...verbatim(branch.slice(0, cut).filter((m) => m.pinned)),
  ];
  return {
    messages: [...layer, ...verbatim(branch.slice(cut))],
    layerEnd: layer.length,
    checkpoint: latest,
  };
}
