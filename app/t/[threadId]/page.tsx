"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ChatShell from "@/components/ChatShell";
import Composer from "@/components/Composer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const n = (x: number) => x.toLocaleString("en-US");
// Per-turn amounts: 4 significant digits; totals of $1 or more: 2 decimals (design doc section 12).
const usd = (micro: number) => `$${micro >= 1e6 ? (micro / 1e6).toFixed(2) : Number((micro / 1e6).toPrecision(4))}`;

const quiet = "cursor-pointer rounded px-1.5 py-0.5 text-xs text-muted enabled:hover:bg-line/60 enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

// "‹ 2/3 ›" between versions of a message (retries or edits), shown only when there are several.
function Versions({ ids, current }: { ids: Id<"messages">[]; current: Id<"messages"> }) {
  const switchBranch = useMutation(api.chat.switchBranch);
  if (ids.length < 2) return null;
  const i = ids.indexOf(current);
  const go = (j: number) => void switchBranch({ messageId: ids[j] });
  return (
    <span className="inline-flex items-center font-mono text-xs text-muted">
      <button className={quiet} disabled={i === 0} onClick={() => go(i - 1)} aria-label="Previous version">
        ‹
      </button>
      {i + 1}/{ids.length}
      <button className={quiet} disabled={i === ids.length - 1} onClick={() => go(i + 1)} aria-label="Next version">
        ›
      </button>
    </span>
  );
}

function UserMessage({ id, text, siblingIds, busy }: { id: Id<"messages">; text: string; siblingIds: Id<"messages">[]; busy: boolean }) {
  const edit = useMutation(api.chat.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  if (editing) {
    return (
      <form
        className="ml-auto flex w-full max-w-[80%] flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void edit({ messageId: id, content: draft }).then(() => setEditing(false));
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          autoFocus
          aria-label="Edit message"
          className="w-full resize-none rounded-2xl border border-line bg-card px-4 py-2.5 outline-none focus:border-accent"
        />
        <div className="flex justify-end gap-2 text-sm">
          <button type="button" className="cursor-pointer rounded-lg px-3 py-1 text-muted hover:bg-line/60" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="cursor-pointer rounded-lg bg-accent px-3 py-1 font-medium text-accent-foreground" disabled={!draft.trim()}>
            Send
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="max-w-[80%] rounded-2xl bg-line/60 px-4 py-2.5 whitespace-pre-wrap">{text}</div>
      <div className="flex items-center gap-1">
        <Versions ids={siblingIds} current={id} />
        <button
          className={`${quiet} opacity-0 group-focus-within:opacity-100 group-hover:opacity-100`}
          disabled={busy}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: Id<"threads"> }>();
  const thread = useQuery(api.chat.getThread, { threadId });
  const send = useMutation(api.chat.send);
  const stop = useMutation(api.chat.stop);
  const retry = useMutation(api.chat.retry);
  const bottom = useRef<HTMLDivElement>(null);
  const last = thread?.messages.at(-1);
  const streaming = last?.status === "streaming";

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [last?.text]);

  return (
    <ChatShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {thread?.messages.map((m) =>
            m.role === "user" ? (
              <UserMessage key={m._id} id={m._id} text={m.text} siblingIds={m.siblingIds} busy={streaming} />
            ) : (
              <div key={m._id} className="flex flex-col gap-1">
                <div className="font-serif text-[16.5px] leading-relaxed whitespace-pre-wrap">
                  {m.text}
                  {m.status === "streaming" && <span className="ml-0.5 animate-pulse text-muted">▍</span>}
                </div>
                {m.usage && (
                  <p className="font-mono text-xs text-muted">
                    {[
                      m.model,
                      m.costMicroUsd === undefined ? "cost unknown" : usd(m.costMicroUsd),
                      `in ${n(m.usage.inputTokens)}`,
                      `cache read ${n(m.usage.cacheReadTokens)}`,
                      `cache write ${n(m.usage.cacheWriteTokens5m + m.usage.cacheWriteTokens1h)}`,
                      `out ${n(m.usage.outputTokens)}`,
                      `reasoning ${n(m.usage.reasoningTokens)}`,
                    ].join(" · ")}
                  </p>
                )}
                {m.status === "stopped" && <p className="font-mono text-xs text-muted">stopped</p>}
                {m.status === "error" && (
                  <p role="alert" className="font-mono text-xs text-danger">
                    {m.error ?? "error"}
                  </p>
                )}
                {m.status !== "streaming" && (
                  <div className="-ml-1.5 flex items-center gap-1">
                    <Versions ids={m.siblingIds} current={m._id} />
                    <button className={quiet} disabled={streaming} onClick={() => void retry({ messageId: m._id })}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>
      </div>
      <Composer
        streaming={streaming}
        onStop={() => last && void stop({ messageId: last._id })}
        onSend={async (text) => {
          try {
            await send({ threadId, content: text });
          } catch (err) {
            throw new Error(err instanceof ConvexError ? String(err.data) : "Could not send");
          }
        }}
      />
    </ChatShell>
  );
}
