"use client";

import {
  IconLayoutSidebarRight,
  IconMessagePlus,
  IconPin,
  IconTrash,
  IconDownload,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import CacheStatus from "@/components/CacheStatus";
import BudgetBanner, { useSendingPaused } from "@/components/BudgetBanner";
import ChatShell from "@/components/ChatShell";
import CostStrip from "@/components/CostStrip";
import Composer from "@/components/Composer";
import Inspector from "@/components/Inspector";
import EffortControl from "@/components/EffortControl";
import ModeControl from "@/components/ModeControl";
import { SearchToggle, useWebSearch } from "@/components/WebSearch";
import ModelMenu, { ModelPickerButton, sameModel, type ModelChoice } from "@/components/ModelMenu";
import { Button as UiButton, IconButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { CheckpointMarker, JumpToLatest, CacheBreakDialog } from "@/components/Messages";
import MessageRow, { ThreadBusyContext, ThreadRowContext, type ThreadMessage } from "@/components/MessageRow";
import { Dialog, Menu, MenuItem, Tooltip } from "@/components/ui/overlay";
import { exportFileName, toJson, toMarkdown } from "@/lib/exportThread";
import { rethrowSendError } from "@/lib/sendError";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { COMPACT, useMedia } from "@/lib/useMedia";
import { toast } from "@/components/ui/toast";
import { imageTokens } from "@/convex/lib/images";
import { SEARCH_TOKENS_ESTIMATE } from "@/convex/lib/webSearch";
import type { Effort } from "@/convex/lib/effort";
import type { MessageImage } from "@/convex/lib/images";
import {
  MODE_MAX_TOKENS,
  OUTPUT_MODES,
  type OutputMode,
} from "@/convex/lib/outputModes";
import Markdown from "@/components/Markdown";
import { api } from "@/convex/_generated/api";
import { estimateTokens } from "@/lib/format";
import { useStoredChoice, useStoredFlag } from "@/lib/storedFlag";
import { useCacheState, useThreadCache } from "@/lib/useCacheState";
import { usePresence } from "@/lib/usePresence";
import { useStableMessages } from "@/lib/stableMessages";
import { isOptimistic, sendOptimistically, useRowKeys } from "@/lib/optimisticSend";
import type { Id } from "@/convex/_generated/dataModel";

// The turns a checkpoint covers, folded behind its summary (spec phase 6): the thread shows what
// the model sees, and the original turns are one click away.
function Condensed<M extends { _id: Id<"messages">; pinned: boolean }>({
  checkpoint,
  messages,
  render,
  revealId,
}: {
  checkpoint: { coveredCount: number; turns: number; summary: string } | null;
  messages: M[];
  render: (m: M) => React.ReactNode;
  revealId: Id<"messages"> | null; // a search hit to show: opens the fold when it's inside
}) {
  const [open, setOpen] = useState(false);
  // Covered pinned messages are still sent verbatim, so the thread shows them after the fold.
  const covered = checkpoint
    ? messages.slice(0, checkpoint.coveredCount).filter((m) => !m.pinned)
    : [];
  const pinnedCount = checkpoint
    ? messages.slice(0, checkpoint.coveredCount).filter((m) => m.pinned).length
    : 0;
  // Opened during render, so the hit's row exists by the time the page scrolls to it.
  const [revealed, setRevealed] = useState<Id<"messages"> | null>(null);
  if (revealId !== revealed) {
    setRevealed(revealId);
    if (revealId && covered.some((m) => m._id === revealId)) setOpen(true);
  }
  if (!checkpoint) return null;
  return (
    <section aria-label="Condensed turns" className="flex flex-col gap-4">
      <CheckpointMarker turns={checkpoint.turns} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <div className="tc-summary tc-banner-in">
          <p className="text-overline text-foreground-muted uppercase">Summary</p>
          <Markdown text={checkpoint.summary} className="tc-prose tc-prose-sm" />
          {pinnedCount > 0 && (
            <p className="flex items-center gap-2 text-body-sm text-foreground-muted">
              <IconPin size={14} stroke={1.5} />
              {pinnedCount === 1
                ? "1 pinned message kept word for word, shown below."
                : `${pinnedCount} pinned messages kept word for word, shown below.`}
            </p>
          )}
          <div className="tc-col-msg mt-2 border-t border-border pt-6">{covered.map(render)}</div>
        </div>
      )}
    </section>
  );
}

// Saves text as a file through a temporary link.
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: Id<"threads"> }>();
  const stored = useQuery(api.chat.getThread, { threadId });
  // Messages that didn't change keep their objects, so their memoized rows skip the update. A
  // streaming reply's text isn't here: its row subscribes to it (ADR 0004).
  const messages = useStableMessages(stored?.messages);
  const thread = useMemo(() => stored && messages && { ...stored, messages }, [stored, messages]);
  // A sent message's real row takes over its optimistic row in place (ticket 08).
  const rowKey = useRowKeys(messages);
  // A search hit to open (spec phase 7): /t/<thread>?m=<message>.
  const target = useSearchParams().get("m") as Id<"messages"> | null;
  const [highlighted, setHighlighted] = useState<Id<"messages"> | null>(null);
  const switchBranch = useMutation(api.chat.switchBranch);
  const switchedFor = useRef<Id<"messages"> | null>(null);
  const send = useMutation(api.chat.send);
  const webSearch = useWebSearch();
  const stop = useMutation(api.chat.stop);
  const deleteThread = useMutation(api.chat.deleteThread);
  const markActive = usePresence(threadId);
  const inspector = useQuery(api.inspector.get, { threadId });
  const settings = useQuery(api.settings.get);
  const threadCache = useThreadCache(threadId);
  const cache = useCacheState(threadCache);
  // Edit hints only while the cache is warm: cold, editing costs no more than continuing.
  const warmHints = inspector?.cache.managed && cache.state !== "cold" ? inspector.editHints : null;
  const breakCosts = useMemo(
    () => new Map(warmHints?.map((h) => [h.messageId, h.extraMicroUsd] as const)),
    [warmHints],
  );
  // The settled draft (the composer owns what's being typed): the cost strip and inspector price it.
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<MessageImage[]>([]);
  const [draftDocTokens, setDraftDocTokens] = useState(0);
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
  // A one-off "reply with" model for the next send only, tied to its thread (spec phase 7).
  const [replyWith, setReplyWith] = useState<{
    threadId: string;
    model: ModelChoice;
  } | null>(null);
  const providers = useQuery(api.providers.list);
  // From primitives, so it keeps its identity across thread updates (rows read it).
  const providerId = thread?.providerId;
  const modelId = thread?.modelId;
  const threadModel = useMemo(
    () => (providerId && modelId !== undefined ? { providerId, modelId } : null),
    [providerId, modelId],
  );
  const oneOff =
    replyWith?.threadId === threadId &&
    threadModel &&
    !sameModel(replyWith.model, threadModel)
      ? replyWith.model
      : null;
  const modelName = (c: ModelChoice) =>
    providers
      ?.find((p) => p._id === c.providerId)
      ?.models.find((m) => m.id === c.modelId)?.displayName ?? c.modelId;
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
    if (extra > threshold) setEffortBreak({ level, extra });
    else await setThreadEffort({ threadId, effort: level });
  };
  // An effort change waiting on the cache-break dialog.
  const [effortBreak, setEffortBreak] = useState<{ level: Effort; extra: number } | null>(null);
  // ↑ in an empty composer: edit the last message you sent on this branch.
  const [editTarget, setEditTarget] = useState<{ id: Id<"messages">; n: number } | null>(null);
  const editLast = () => {
    const mine = thread?.messages.findLast((m) => m.role === "user");
    if (mine) {
      setEditTarget({ id: mine._id, n: (editTarget?.n ?? 0) + 1 });
      document.getElementById(`m-${mine._id}`)?.scrollIntoView({ block: "nearest" });
    }
  };
  // ⌥← / ⌥→ with focus inside a message: its previous or next version.
  const onBranchKeys = (e: React.KeyboardEvent) => {
    if (!e.altKey || e.metaKey || e.ctrlKey || e.target instanceof HTMLTextAreaElement) return;
    const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const id = (e.target as HTMLElement).closest("article[id^='m-']")?.id.slice(2);
    const m = d && id ? thread?.messages.find((x) => x._id === id) : undefined;
    const next = m?.siblingIds[m.siblingIds.indexOf(m._id) + d];
    if (!next) return;
    e.preventDefault();
    void switchBranch({ messageId: next });
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const paused = useSendingPaused();
  const inspectorKbd = useShortcutLabel(SHORTCUTS.toggleInspector);
  const modelKbd = useShortcutLabel(SHORTCUTS.modelPicker);
  const [inspectorOpen, setInspectorOpen] = useStoredFlag(
    "tally.inspectorOpen",
    false,
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  // The column on wide screens, a bottom sheet under 1200px (spec phase 8).
  const compact = useMedia(COMPACT);
  const inspectorShown = compact ? sheetOpen : inspectorOpen;
  const toggleInspector = () =>
    compact ? setSheetOpen(!sheetOpen) : setInspectorOpen(!inspectorOpen);
  useShortcut(SHORTCUTS.toggleInspector, toggleInspector);

  // Opens the inspector and, given a section, scrolls it into view.
  const openInspector = (section?: "cache") => {
    if (compact) setSheetOpen(true);
    else setInspectorOpen(true);
    if (section)
      setTimeout(
        () =>
          document
            .querySelectorAll(`[data-inspector-section="${section}"]`)
            .forEach((el) => el.scrollIntoView({ block: "nearest", behavior: "smooth" })),
        250,
      );
  };
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // What every row reads. An explicit memo: the compiler leaves a plain object literal here
  // unmemoized (it sits between hook calls), and a new value re-renders every row.
  const confirmAbove = settings?.cacheBreakConfirmMicroUsd ?? 100_000;
  const rowContext = useMemo(
    () => ({
      threadId,
      mode,
      threadModel,
      confirmAbove,
      onType: markActive,
      // Continue a cut-off reply: an ordinary next turn (5.5 models don't allow prefill).
      onContinue: () => {
        setAtBottom(true);
        void sendOptimistically(send, { threadId, content: "Continue.", mode }).catch(() => {});
      },
    }),
    [threadId, mode, threadModel, confirmAbove, markActive, send],
  );
  const last = thread?.messages.at(-1);
  // A reply waiting for approval is still in progress: sending is paused, Stop is offered.
  const streaming = last?.status === "streaming" || last?.status === "waiting";

  // ⌘⇧C copies the last finished reply on this branch.
  useShortcut(SHORTCUTS.copyLastReply, () => {
    const reply = thread?.messages.findLast((m) => m.role === "assistant" && m.status !== "streaming" && m.status !== "waiting" && m.text);
    if (reply)
      void navigator.clipboard.writeText(reply.text).then(() => toast({ title: "Copied the last reply" }));
  });
  const toBottom = () =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  // Follow the last message as it grows (streamed text, tool steps, a status change) and each new
  // turn, only while the reader is at the bottom, so scrolling up to read isn't yanked back.
  // Watching its size means the streaming row needn't tell the page about each chunk.
  const lastId = last?._id;
  useEffect(() => {
    const el = lastId && document.getElementById(`m-${lastId}`);
    if (!atBottom || !el) return;
    const follow = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [atBottom, lastId]);

  // Opening a search hit: switch to the branch holding it if needed (once), then mark it, which
  // opens a fold around it; the next effect scrolls to it. The URL drops the hit afterwards.
  const targetOnBranch =
    !!target && !!thread?.messages.some((m) => m._id === target);
  const [handled, setHandled] = useState<Id<"messages"> | null>(null);
  if (handled !== (targetOnBranch ? target : null)) {
    setHandled(targetOnBranch ? target : null);
    if (targetOnBranch) {
      setHighlighted(target);
      setAtBottom(false);
    }
  }
  useEffect(() => {
    if (!target || !thread) return;
    if (targetOnBranch) router.replace(`/t/${threadId}`, { scroll: false });
    else if (switchedFor.current !== target) {
      switchedFor.current = target;
      void switchBranch({ messageId: target, threadId }).catch(() => {});
    }
  }, [target, thread, targetOnBranch, switchBranch, router, threadId]);
  useEffect(() => {
    if (!highlighted) return;
    document
      .getElementById(`m-${highlighted}`)
      ?.scrollIntoView({ block: "start" });
    // A thread too short to scroll fires no scroll event: measure where that left the reader.
    const frame = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el)
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    });
    const timer = setTimeout(() => setHighlighted(null), 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [highlighted]);

  if (thread === null) {
    return (
      <ChatShell>
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <EmptyState
            className="w-full max-w-md"
            title="This thread was deleted."
            description="It no longer exists on this server. Its spend still counts in Usage."
            action={
              <Link href="/" className="tc-btn tc-btn-primary holo-border holo-sweep">
                <IconMessagePlus size={16} stroke={1.5} />
                New thread
              </Link>
            }
          />
        </div>
      </ChatShell>
    );
  }

  // One message on the branch, as the thread shows it (also inside the condensed fold).
  const renderMessage = (m: ThreadMessage) => (
    <MessageRow
      key={rowKey(m._id)}
      message={m}
      highlighted={highlighted === m._id}
      isLast={m._id === last?._id}
      breakCost={breakCosts.get(m._id) ?? null}
      editRequest={editTarget?.id === m._id ? editTarget.n : null}
    />
  );

  return (
    <ChatShell
      header={
        <>
          <h1 className="min-w-0 truncate text-subheading">{thread?.title}</h1>
          {thread?.importedFrom && (
            <Tooltip content="Imported from a data export; its messages carry no cost">
              <span className="hidden shrink-0 min-[900px]:inline-flex">
                <Badge>imported from {thread.importedFrom === "chatgpt" ? "ChatGPT" : "Claude"}</Badge>
              </span>
            </Tooltip>
          )}
          {thread?.cacheManaged && (
            <CacheStatus
              {...threadCache}
              onOpen={() => openInspector("cache")}
            />
          )}
          <span className="flex-1" />
          {thread && (
            <Menu
              align="end"
              trigger={<IconButton icon={<IconDownload />} label="Export thread" />}
            >
              <MenuItem onClick={() => download(exportFileName(thread.title, "md"), toMarkdown(thread, new Date()), "text/markdown")}>
                Markdown
              </MenuItem>
              <MenuItem onClick={() => download(exportFileName(thread.title, "json"), toJson(thread, new Date()), "application/json")}>
                JSON, with usage and cost
              </MenuItem>
            </Menu>
          )}
          <IconButton
            icon={<IconTrash />}
            label="Delete thread"
            onClick={() => setConfirmDelete(true)}
          />
          <IconButton
            icon={<IconLayoutSidebarRight />}
            label="Toggle inspector"
            kbd={inspectorKbd}
            aria-pressed={inspectorShown}
            onClick={toggleInspector}
          />
          {effortBreak && (
            <CacheBreakDialog
              open
              extraMicroUsd={effortBreak.extra}
              action={{ verb: "Changing effort on this model", confirm: "Change anyway" }}
              body="This model can't change effort per message, so the thread's history is written to the cache again on the next send."
              onConfirm={() => {
                void setThreadEffort({ threadId, effort: effortBreak.level });
                setEffortBreak(null);
              }}
              onCancel={() => setEffortBreak(null)}
            />
          )}
          <Dialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            tone="danger"
            icon={<IconTrash size={18} stroke={1.5} />}
            title="Delete this thread?"
            description="Its messages are removed for good. Your spend history keeps its cost."
            actions={
              <>
                <UiButton onClick={() => setConfirmDelete(false)}>Cancel</UiButton>
                <UiButton
                  variant="danger"
                  onClick={() => {
                    setConfirmDelete(false);
                    // Leave first, so this page never queries a thread that no longer exists.
                    router.push("/");
                    void deleteThread({ threadId });
                  }}
                >
                  Delete thread
                </UiButton>
              </>
            }
          />
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
              <div className="tc-col-msg tc-thread-col" onKeyDown={onBranchKeys}>
                <ThreadRowContext value={rowContext}>
                <ThreadBusyContext value={streaming}>
                {thread && (
                  <Condensed
                    checkpoint={thread.checkpoint}
                    messages={thread.messages}
                    render={renderMessage}
                    revealId={highlighted}
                  />
                )}
                {thread?.messages
                  .slice(0, thread.checkpoint?.coveredCount ?? 0)
                  .filter((m) => m.pinned)
                  .map(renderMessage)}
                {thread?.messages
                  .slice(thread.checkpoint?.coveredCount ?? 0)
                  .map(renderMessage)}
                </ThreadBusyContext>
                </ThreadRowContext>
              </div>
            </div>
            {!atBottom && <JumpToLatest onClick={toBottom} />}
          </div>
          <Composer
            threadId={threadId}
            streaming={streaming}
            // An optimistic placeholder has no reply to stop yet.
            onStop={() => last && !isOptimistic(last._id) && void stop({ messageId: last._id })}
            onType={markActive}
            onDraftChange={setDraft}
            onEditLast={streaming ? undefined : editLast}
            paused={paused}
            banner={<BudgetBanner />}
            footer={
              <CostStrip
                threadId={threadId}
                draft={draft}
                draftImages={draftImages}
                draftDocTokens={draftDocTokens}
                mode={mode}
                onOpen={toggleInspector}
              />
            }
            controls={
              <>
                {threadModel && (
                  <ModelMenu
                    title="Reply with, for this message only"
                    threadId={threadId}
                    hotkey
                    draftTokens={
                      estimateTokens(draft) +
                      draftImages.reduce((sum, i) => sum + imageTokens(i), 0) +
                      draftDocTokens +
                      (webSearch.on ? SEARCH_TOKENS_ESTIMATE : 0)
                    }
                    maxOutputTokens={MODE_MAX_TOKENS[mode]}
                    selected={oneOff ?? threadModel}
                    onPick={(model) => setReplyWith({ threadId, model })}
                    trigger={
                      <ModelPickerButton
                        name={modelName(oneOff ?? threadModel)}
                        oneOff={!!oneOff}
                        title={
                          oneOff
                            ? "This message goes to another model once; the thread keeps its model and cache"
                            : `Reply with another model, for this message only (${modelKbd})`
                        }
                      />
                    }
                  />
                )}
                {inspector?.effort && !oneOff && (
                  <EffortControl
                    value={pendingEffort ?? inspector.effort}
                    pending={pendingEffort !== null}
                    perMessage={inspector.perMessageEffort}
                    onChange={(level) => void changeEffort(level)}
                  />
                )}
                <ModeControl value={mode} onChange={setMode} />
                {webSearch.available && (
                  <SearchToggle on={webSearch.on} onChange={webSearch.setOn} />
                )}
              </>
            }
            canAttach={thread?.vision ?? false}
            onImagesChange={setDraftImages}
            onDocumentsChange={setDraftDocTokens}
            attachNote={
              // The first image in a thread with history (spec phase 4). Wording provisional
              // until the real-API session (phase 2 ticket 06) confirms the cache effect.
              draftImages.length > 0 &&
              (thread?.messages.length ?? 0) > 0 &&
              !thread?.messages.some((m) => m.images?.length)
                ? "First image in this thread: the provider may write the history to the cache again."
                : undefined
            }
            onSend={async (text, images, documents, shown) => {
              setAtBottom(true);
              await sendOptimistically(send, {
                threadId,
                content: text,
                mode,
                // A per-message effort change waits for the thread's own model.
                effort: oneOff ? undefined : (pendingEffort ?? undefined),
                images: images.length ? images : undefined,
                model: oneOff ?? undefined,
                search: webSearch.on || undefined,
                documents: documents.length ? documents : undefined,
              }, shown).catch(rethrowSendError);
              if (oneOff) setReplyWith(null);
              else setPendingEffort(null);
            }}
          />
        </div>
        <Inspector
          threadId={threadId}
          draft={draft}
          draftImages={draftImages}
          draftDocTokens={draftDocTokens}
          open={inspectorShown}
          compact={compact}
          onClose={() => (compact ? setSheetOpen(false) : setInspectorOpen(false))}
          closeKbd={inspectorKbd}
        />
      </div>
    </ChatShell>
  );
}
