import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { ReactMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Thread = NonNullable<FunctionReturnType<typeof api.chat.getThread>>;
type SendArgs = Pick<FunctionArgs<typeof api.chat.send>, "content" | "images" | "search" | "effort">;
/** What the composer shows of the attachments, which the send's ids alone can't: image previews and document names. */
export type SentAttachments = {
  images: string[];
  documents: { name: string; tokens: number; fromThreadId: Id<"threads"> | undefined; fromSkillId: Id<"skills"> | undefined }[]; // a mentioned thread or invoked skill: its id
};

// Placeholder ids exist only in the local query result: never pass one to a query, mutation or action.
const PREFIX = "optimistic:";
export const isOptimistic = (id: string) => id.startsWith(PREFIX);

/**
 * The thread as it looks right after sending (Phase 12 ticket 08): my message and a streaming
 * reply placeholder at the end of the branch, until the server's result replaces them.
 */
export function withSentTurn(thread: Thread, args: SendArgs, shown: SentAttachments, key: string): Thread {
  const userId = `${PREFIX}${key}-user` as Id<"messages">;
  const replyId = `${PREFIX}${key}-reply` as Id<"messages">;
  const base = {
    pinned: false,
    pinLocked: false,
    text: "",
    items: undefined,
    hitStepLimit: undefined,
    approvalExpired: undefined,
    error: undefined,
    model: undefined,
    modelName: undefined,
    usage: undefined,
    costMicroUsd: undefined,
    truncated: undefined,
    effort: undefined,
    images: undefined,
    documents: undefined,
    search: undefined,
  };
  return {
    ...thread,
    messages: [
      ...thread.messages,
      {
        ...base,
        _id: userId,
        siblingIds: [userId],
        role: "user",
        status: "done",
        text: args.content.trim(),
        effort: args.effort,
        images: args.images?.map((i, k) => ({ url: shown.images[k] ?? null, width: i.width, height: i.height })),
        documents: shown.documents.length ? shown.documents : undefined,
        search: args.search ? { status: "pending", results: [] } : undefined,
      },
      { ...base, _id: replyId, siblingIds: [replyId], role: "assistant", status: "streaming" },
    ],
  };
}

/**
 * Sends with my message and the reply placeholder in the thread at once. Convex drops them when
 * the server's result arrives, or when the send fails (and the caller's promise rejects).
 */
export function sendOptimistically(
  send: ReactMutation<typeof api.chat.send>,
  args: FunctionArgs<typeof api.chat.send>,
  shown: SentAttachments = { images: [], documents: [] },
) {
  // Outside the update, which Convex re-runs on every server update: the ids must stay the same.
  const key = crypto.randomUUID();
  return send.withOptimisticUpdate((store) => {
    const query = { threadId: args.threadId };
    const thread = store.getQuery(api.chat.getThread, query);
    if (thread) store.setQuery(api.chat.getThread, query, withSentTurn(thread, args, shown, key));
  })(args);
}

/**
 * Row keys by message id: a real message that arrives where a placeholder was keeps the
 * placeholder's key, so its row updates in place instead of remounting (no replayed entrance).
 */
export function carryRowKeys<M extends { _id: string }>(
  keys: Map<string, string>,
  prev: M[] | undefined,
  next: M[],
): Map<string, string> {
  const out = new Map<string, string>();
  const prevIds = new Set(prev?.map((m) => m._id));
  next.forEach((m, i) => {
    const was = prev?.[i];
    const key =
      keys.get(m._id) ??
      (was && isOptimistic(was._id) && !isOptimistic(m._id) && !prevIds.has(m._id)
        ? (keys.get(was._id) ?? was._id)
        : undefined);
    if (key) out.set(m._id, key);
  });
  return out;
}

/** carryRowKeys across query updates: a message's row key (its id unless it replaced a placeholder). */
export function useRowKeys<M extends { _id: string }>(messages: M[] | undefined) {
  // Updated during render, like useStableMessages, so the swap's render already has the keys.
  const [kept, setKept] = useState<{ from: M[] | undefined; keys: Map<string, string> }>({
    from: messages,
    keys: new Map(),
  });
  let keys = kept.keys;
  if (kept.from !== messages) {
    keys = messages ? carryRowKeys(kept.keys, kept.from, messages) : new Map();
    setKept({ from: messages, keys });
  }
  return (id: string) => keys.get(id) ?? id;
}
