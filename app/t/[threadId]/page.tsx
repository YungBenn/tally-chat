"use client";

import {
  IconArrowDown,
  IconChevronLeft,
  IconChevronRight,
  IconLayoutSidebarRight,
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
import BudgetBanner from "@/components/BudgetBanner";
import ChatShell from "@/components/ChatShell";
import CostStrip from "@/components/CostStrip";
import Composer from "@/components/Composer";
import Inspector from "@/components/Inspector";
import EffortControl from "@/components/EffortControl";
import ModeControl from "@/components/ModeControl";
import type { Effort } from "@/convex/lib/effort";
import type { MessageImage } from "@/convex/lib/images";
import { OUTPUT_MODES, type OutputMode } from "@/convex/lib/outputModes";
import Markdown, { CopyButton } from "@/components/Markdown";
import { Button } from "@/components/wensity/button";
import { Textarea } from "@/components/wensity/text-area";
import { api } from "@/convex/_generated/api";
import { estimateTokens, metaLine, tokens, usd } from "@/lib/format";
import { useStoredChoice, useStoredFlag } from "@/lib/storedFlag";
import { useCacheState } from "@/lib/useCacheState";
import { usePresence } from "@/lib/usePresence";
import type { Id } from "@/convex/_generated/dataModel";

// The muted, always-visible metadata line under a reply (cost layer: monospace, tabular).
const meta = "font-mono text-xs leading-5 text-muted-foreground tabular-nums";

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
  images,
  siblingIds,
  busy,
  onType,
  breakCost,
  confirmAbove,
  mode,
}: {
  mode: OutputMode;
  id: Id<"messages">;
  text: string;
  images?: { url: string | null; width: number; height: number }[];
  siblingIds: Id<"messages">[];
  busy: boolean;
  onType: () => void;
  breakCost: number | null; // extra micro-dollars editing here costs, when it breaks the cache
  confirmAbove: number;
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
                if (
                  breakCost !== null &&
                  breakCost > confirmAbove &&
                  !confirm(
                    `Editing here breaks the prompt cache: the next send costs about ${usd(breakCost)} more than continuing. Edit anyway?`,
                  )
                )
                  return;
                setDraft(text);
                setEditing(true);
              }}
            >
              <IconPencil />
            </button>
            {breakCost !== null && (
              <span
                className="font-mono text-xs text-muted-foreground"
                title="Editing forks the thread here, so everything after the system prompt is written to the cache again"
              >
                breaks cache · +{usd(breakCost)}
              </span>
            )}
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
            void edit({ messageId: id, content: draft, mode }).then(() =>
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
        <div className="flex flex-col gap-2">
          {images && images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {images.map((image, i) =>
                image.url ? (
                  <a
                    key={i}
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open full size"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, already downscaled */}
                    <img
                      src={image.url}
                      alt={`Attached image ${i + 1}`}
                      width={image.width}
                      height={image.height}
                      className="max-h-60 w-auto rounded-lg border border-border object-contain"
                    />
                  </a>
                ) : null,
              )}
            </div>
          )}
          <div className="text-[15px] leading-7 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {text}
          </div>
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
  const inspector = useQuery(api.inspector.get, { threadId });
  const settings = useQuery(api.settings.get);
  const cache = useCacheState(
    inspector?.cache ?? {
      expiresAt: null,
      keepaliveScheduled: false,
      lastActiveAt: null,
    },
  );
  // Edit hints only while the cache is warm: cold, editing costs no more than continuing.
  const breakCosts = new Map(
    inspector?.cache.managed && cache.state !== "cold"
      ? inspector.editHints.map((h) => [h.messageId, h.extraMicroUsd] as const)
      : [],
  );
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<MessageImage[]>([]);
  const [mode, setMode] = useStoredChoice<OutputMode>(
    `tally.mode.${threadId}`,
    "normal",
    OUTPUT_MODES,
  );
  // A per-message effort change waiting for the next send, tied to its thread like `turn`.
  const [pending, setPending] = useState<{
    threadId: string;
    effort: Effort;
  } | null>(null);
  const pendingEffort = pending?.threadId === threadId ? pending.effort : null;
  const setPendingEffort = (effort: Effort | null) =>
    setPending(effort && { threadId, effort });
  const setThreadEffort = useMutation(api.chat.setThreadEffort);
  const changeEffort = async (level: Effort) => {
    if (!inspector?.effort) return;
    if (inspector.perMessageEffort) {
      // Applies from the next message; picking the level already in force cancels the change.
      setPendingEffort(level === inspector.effort ? null : level);
      return;
    }
    // No per-message effort on this model: the thread's level changes, rewriting the cache.
    const p = inspector.next.prices;
    const extra =
      p && inspector.cache.managed && cache.state !== "cold"
        ? Math.round(
            inspector.next.prefixTokens * (p.cacheWrite - p.cacheRead) * 1e6,
          )
        : 0;
    const threshold = settings?.cacheBreakConfirmMicroUsd ?? 100_000;
    if (
      extra > threshold &&
      !confirm(
        `Changing effort on this model breaks the prompt cache: the next send costs about ${usd(extra)} more. Change it anyway?`,
      )
    )
      return;
    await setThreadEffort({ threadId, effort: level });
  };

  // Continue a cut-off reply: an ordinary next turn (5.5 models don't allow prefill).
  const continueReply = () => {
    setAtBottom(true);
    return send({ threadId, content: "Continue.", mode }).catch(() => {});
  };
  const [inspectorOpen, setInspectorOpen] = useStoredFlag(
    "tally.inspectorOpen",
    false,
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  // A reply shown on its own in the inspector, remembered with its thread so it never follows
  // the owner into another one (this page stays mounted across threads).
  const [turn, setTurn] = useState<{
    threadId: string;
    id: Id<"messages">;
  } | null>(null);
  const turnId = turn?.threadId === threadId ? turn.id : null;
  const setTurnId = (id: Id<"messages"> | null) =>
    setTurn(id && { threadId, id });
  // The rail on desktop, the bottom sheet on phones (Tailwind's md breakpoint).
  const toggleInspector = () => {
    if (matchMedia("(min-width: 48rem)").matches)
      setInspectorOpen(!inspectorOpen);
    else setSheetOpen(!sheetOpen);
  };

  // Opens the inspector (rail or sheet) and, given a section, scrolls it into view.
  const openInspector = (section?: "cache") => {
    if (matchMedia("(min-width: 48rem)").matches) setInspectorOpen(true);
    else setSheetOpen(true);
    if (section)
      requestAnimationFrame(() =>
        document
          .querySelectorAll(`[data-inspector-section="${section}"]`)
          .forEach((el) =>
            el.scrollIntoView({ block: "nearest", behavior: "smooth" }),
          ),
      );
  };

  // ⌘I (Ctrl+I elsewhere) toggles the inspector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "i"
      ) {
        e.preventDefault();
        toggleInspector();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
          {thread?.cacheManaged && (
            <CacheStatus
              expiresAt={thread.cacheExpiresAt}
              keepaliveScheduled={thread.keepaliveScheduled}
              lastActiveAt={thread.lastActiveAt}
              onOpen={() => openInspector("cache")}
            />
          )}
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
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Inspector"
            aria-pressed={inspectorOpen || sheetOpen}
            title="Inspector (⌘I)"
            onClick={toggleInspector}
          >
            <IconLayoutSidebarRight />
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              ref={scroller}
              className="h-full overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                setAtBottom(
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80,
                );
              }}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-4 pb-10">
                {thread?.messages.map((m) =>
                  m.role === "user" ? (
                    <UserMessage
                      key={m._id}
                      id={m._id}
                      text={m.text}
                      images={m.images}
                      siblingIds={m.siblingIds}
                      busy={streaming}
                      onType={markActive}
                      breakCost={breakCosts.get(m._id) ?? null}
                      confirmAbove={
                        settings?.cacheBreakConfirmMicroUsd ?? 100_000
                      }
                      mode={mode}
                    />
                  ) : (
                    <MessageRow
                      key={m._id}
                      avatar={<span className="font-mono">t</span>}
                      author={m.modelName ?? m.model ?? "Assistant"}
                      latest={m._id === last?._id}
                      actions={
                        m.status !== "streaming" && (
                          <>
                            <CopyButton text={m.text} className="icon-action" />
                            <button
                              className="icon-action"
                              disabled={streaming}
                              onClick={() =>
                                void retry({ messageId: m._id, mode })
                              }
                              aria-label="Retry"
                              title="Retry"
                            >
                              <IconRefresh />
                            </button>
                            <Versions ids={m.siblingIds} current={m._id} />
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
                      {m.status === "streaming"
                        ? m.text && (
                            <p className={meta}>
                              ~{tokens(estimateTokens(m.text))} out
                            </p>
                          )
                        : m.usage && (
                            <button
                              type="button"
                              className={`${meta} self-start text-left hover:text-foreground`}
                              title="Open this reply in the inspector"
                              onClick={() => {
                                setTurnId(m._id);
                                openInspector();
                              }}
                            >
                              {metaLine(
                                m.modelName ?? m.model ?? "",
                                m.costMicroUsd,
                                m.usage,
                                m.effort,
                              )}
                            </button>
                          )}
                      {m.truncated && (
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          Cut off at the length limit.
                          {m._id === last?._id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void continueReply()}
                            >
                              Continue
                            </Button>
                          )}
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
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md [--surface-face:var(--surface)]"
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
            onDraftChange={setDraft}
            banner={<BudgetBanner />}
            footer={
              <CostStrip
                threadId={threadId}
                draft={draft}
                draftImages={draftImages}
                mode={mode}
                onOpen={toggleInspector}
              />
            }
            controls={
              <>
                <ModeControl value={mode} onChange={setMode} />
                {inspector?.effort && (
                  <EffortControl
                    value={pendingEffort ?? inspector.effort}
                    pending={pendingEffort !== null}
                    perMessage={inspector.perMessageEffort}
                    onChange={(level) => void changeEffort(level)}
                  />
                )}
              </>
            }
            canAttach={thread?.vision ?? false}
            onImagesChange={setDraftImages}
            attachNote={
              // The first image in a thread with history (spec phase 4). Wording provisional
              // until the real-API session (phase 2 ticket 06) confirms the cache effect.
              draftImages.length > 0 &&
              (thread?.messages.length ?? 0) > 0 &&
              !thread?.messages.some((m) => m.images?.length)
                ? "First image in this thread: the provider may write the history to the cache again."
                : undefined
            }
            onSend={async (text, images) => {
              setAtBottom(true);
              try {
                await send({
                  threadId,
                  content: text,
                  mode,
                  effort: pendingEffort ?? undefined,
                  images: images.length ? images : undefined,
                });
                setPendingEffort(null);
              } catch (err) {
                throw new Error(
                  err instanceof ConvexError
                    ? String(err.data)
                    : "Could not send",
                );
              }
            }}
          />
        </div>
        <Inspector
          threadId={threadId}
          draft={draft}
          draftImages={draftImages}
          turnId={turnId}
          onBack={() => setTurnId(null)}
          railOpen={inspectorOpen}
          sheetOpen={sheetOpen}
          onCloseRail={() => setInspectorOpen(false)}
          onCloseSheet={() => setSheetOpen(false)}
        />
      </div>
    </ChatShell>
  );
}
