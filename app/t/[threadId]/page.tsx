"use client";

import {
  IconArrowDown,
  IconChevronLeft,
  IconChevronRight,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CacheStatus from "@/components/CacheStatus";
import ChatShell from "@/components/ChatShell";
import Composer from "@/components/Composer";
import Markdown, { CopyButton } from "@/components/Markdown";
import { Button } from "@/components/wensity/button";
import { Textarea } from "@/components/wensity/text-area";
import { api } from "@/convex/_generated/api";
import { usePresence } from "@/lib/usePresence";
import type { Id } from "@/convex/_generated/dataModel";

const n = (x: number) => x.toLocaleString("en-US");
// Per-turn amounts: 4 significant digits; totals of $1 or more: 2 decimals (design doc section 12).
const usd = (micro: number) =>
  `$${micro >= 1e6 ? (micro / 1e6).toFixed(2) : Number((micro / 1e6).toPrecision(4))}`;

// "‹ 2/3 ›" between versions of a message (retries or edits), shown only when there are several.
function Versions({
  ids,
  current,
}: {
  ids: Id<"messages">[];
  current: Id<"messages">;
}) {
  const switchBranch = useMutation(api.chat.switchBranch);
  if (ids.length < 2) return null;
  const i = ids.indexOf(current);
  const go = (j: number) => void switchBranch({ messageId: ids[j] });
  return (
    <span className="inline-flex items-center font-mono text-xs text-muted-foreground tabular-nums">
      <button
        className="icon-action"
        disabled={i === 0}
        onClick={() => go(i - 1)}
        aria-label="Previous version"
        title="Previous version"
      >
        <IconChevronLeft />
      </button>
      {i + 1}/{ids.length}
      <button
        className="icon-action"
        disabled={i === ids.length - 1}
        onClick={() => go(i + 1)}
        aria-label="Next version"
        title="Next version"
      >
        <IconChevronRight />
      </button>
    </span>
  );
}

// One message row: avatar, author, body, and an action bar that shows on hover (always on the latest reply).
function MessageRow({
  avatar,
  author,
  actions,
  latest,
  children,
}: {
  avatar: React.ReactNode;
  author: string;
  actions?: React.ReactNode;
  latest?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="group flex gap-4">
      <div className="grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-semibold [&_svg]:size-4">
        {avatar}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-sm font-semibold leading-7">{author}</h3>
        {children}
        {actions && (
          <div
            className={`-ml-1.5 flex min-h-7 flex-wrap items-center gap-0.5 transition-opacity ${latest ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}
          >
            {actions}
          </div>
        )}
      </div>
    </article>
  );
}

function UserMessage({
  id,
  text,
  siblingIds,
  busy,
  onType,
}: {
  id: Id<"messages">;
  text: string;
  siblingIds: Id<"messages">[];
  busy: boolean;
  onType: () => void;
}) {
  const edit = useMutation(api.chat.edit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  return (
    <MessageRow
      avatar={<IconUser />}
      author="You"
      actions={
        !editing && (
          <>
            <CopyButton text={text} className="icon-action" />
            <button
              className="icon-action"
              disabled={busy}
              aria-label="Edit"
              title="Edit"
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              <IconPencil />
            </button>
            <Versions ids={siblingIds} current={id} />
          </>
        )
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void edit({ messageId: id, content: draft }).then(() =>
              setEditing(false),
            );
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              onType();
            }}
            autoResize
            minRows={2}
            autoFocus
            aria-label="Edit message"
            textareaClassName="text-[15px]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              Save & send
            </Button>
          </div>
        </form>
      ) : (
        <div className="text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}
        </div>
      )}
    </MessageRow>
  );
}

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: Id<"threads"> }>();
  const thread = useQuery(api.chat.getThread, { threadId });
  const send = useMutation(api.chat.send);
  const stop = useMutation(api.chat.stop);
  const retry = useMutation(api.chat.retry);
  const deleteThread = useMutation(api.chat.deleteThread);
  const markActive = usePresence(threadId);
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const last = thread?.messages.at(-1);
  const streaming = last?.status === "streaming";

  const toBottom = () =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  // Follow new text only while the reader is at the bottom, so scrolling up to read isn't yanked back.
  useEffect(() => {
    if (atBottom) toBottom();
  }, [last?.text, thread?.messages.length, atBottom]);

  if (thread === null) {
    return (
      <ChatShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4">
          <p className="text-xl font-semibold tracking-[-0.02em] text-muted-foreground">
            This thread was deleted.
          </p>
          <Link
            href="/"
            className="text-sm underline underline-offset-2 hover:text-foreground"
          >
            Start a new thread
          </Link>
        </div>
      </ChatShell>
    );
  }

  return (
    <ChatShell
      header={
        <>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {thread?.title}
          </h1>
          {thread?.cacheManaged && <CacheStatus expiresAt={thread.cacheExpiresAt} />}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-primitive-destructive"
            aria-label="Delete thread"
            title="Delete thread"
            onClick={() => {
              if (
                !confirm(
                  "Delete this thread? Its messages are removed for good. Your spend history keeps its cost.",
                )
              )
                return;
              // Leave first, so this page never queries a thread that no longer exists.
              router.push("/");
              void deleteThread({ threadId });
            }}
          >
            <IconTrash />
          </Button>
        </>
      }
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="h-full overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-4 pb-10">
            {thread?.messages.map((m) =>
              m.role === "user" ? (
                <UserMessage
                  key={m._id}
                  id={m._id}
                  text={m.text}
                  siblingIds={m.siblingIds}
                  busy={streaming}
                  onType={markActive}
                />
              ) : (
                <MessageRow
                  key={m._id}
                  avatar={<span className="font-mono">t</span>}
                  author={m.model ?? "Assistant"}
                  latest={m._id === last?._id}
                  actions={
                    m.status !== "streaming" && (
                      <>
                        <CopyButton text={m.text} className="icon-action" />
                        <button
                          className="icon-action"
                          disabled={streaming}
                          onClick={() => void retry({ messageId: m._id })}
                          aria-label="Retry"
                          title="Retry"
                        >
                          <IconRefresh />
                        </button>
                        <Versions ids={m.siblingIds} current={m._id} />
                        {m.usage && (
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {[
                              m.costMicroUsd === undefined
                                ? "cost unknown"
                                : usd(m.costMicroUsd),
                              `in ${n(m.usage.inputTokens)}`,
                              `cache read ${n(m.usage.cacheReadTokens)}`,
                              `cache write ${n(m.usage.cacheWriteTokens5m + m.usage.cacheWriteTokens1h)}`,
                              `out ${n(m.usage.outputTokens)}`,
                              `reasoning ${n(m.usage.reasoningTokens)}`,
                            ].join(" · ")}
                          </span>
                        )}
                      </>
                    )
                  }
                >
                  {m.text ? (
                    <Markdown text={m.text} />
                  ) : (
                    m.status === "streaming" && (
                      <span className="leading-7 text-muted-foreground">
                        Thinking…
                      </span>
                    )
                  )}
                  {m.status === "streaming" && m.text && (
                    <span
                      aria-hidden
                      className="mt-1 inline-block size-2.5 animate-pulse rounded-full bg-foreground"
                    />
                  )}
                  {m.status === "stopped" && (
                    <p className="font-mono text-xs text-muted-foreground">
                      stopped
                    </p>
                  )}
                  {m.status === "error" && (
                    <p
                      role="alert"
                      className="rounded-[var(--primitive-radius-item)] border border-[var(--primitive-destructive-border)] px-3 py-2 text-sm text-primitive-destructive"
                    >
                      {m.error ?? "Something went wrong"}
                    </p>
                  )}
                </MessageRow>
              ),
            )}
          </div>
        </div>
        {!atBottom && (
          <Button
            variant="outline"
            size="icon"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full"
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            onClick={toBottom}
          >
            <IconArrowDown />
          </Button>
        )}
      </div>
      <Composer
        streaming={streaming}
        onStop={() => last && void stop({ messageId: last._id })}
        onType={markActive}
        onSend={async (text) => {
          setAtBottom(true);
          try {
            await send({ threadId, content: text });
          } catch (err) {
            throw new Error(
              err instanceof ConvexError ? String(err.data) : "Could not send",
            );
          }
        }}
      />
    </ChatShell>
  );
}
