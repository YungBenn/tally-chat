"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import ChatShell from "@/components/ChatShell";
import Composer from "@/components/Composer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const n = (x: number) => x.toLocaleString("en-US");
// Per-turn amounts: 4 significant digits; totals of $1 or more: 2 decimals (design doc section 12).
const usd = (micro: number) => `$${micro >= 1e6 ? (micro / 1e6).toFixed(2) : Number((micro / 1e6).toPrecision(4))}`;

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: Id<"threads"> }>();
  const thread = useQuery(api.chat.getThread, { threadId });
  const send = useMutation(api.chat.send);
  const stop = useMutation(api.chat.stop);
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
              <div key={m._id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-line/60 px-4 py-2.5 whitespace-pre-wrap">{m.text}</div>
              </div>
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
