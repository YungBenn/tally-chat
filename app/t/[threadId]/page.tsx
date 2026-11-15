"use client";

import {
  IconLayoutSidebarRight,
  IconMessagePlus,
  IconPlayerPlay,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconRefresh,
  IconArrowsExchange,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CacheStatus from "@/components/CacheStatus";
import BudgetBanner from "@/components/BudgetBanner";
import ChatShell from "@/components/ChatShell";
import CostStrip from "@/components/CostStrip";
import Composer from "@/components/Composer";
import Inspector from "@/components/Inspector";
import EffortControl from "@/components/EffortControl";
import ModeControl from "@/components/ModeControl";
import ModelMenu, { ModelPickerButton, sameModel, type ModelChoice } from "@/components/ModelMenu";
import { Button as UiButton, IconButton } from "@/components/ui/button";
import { Badge, EmptyState, ErrorState } from "@/components/ui/feedback";
import { Textarea as UiTextarea } from "@/components/ui/fields";
import {
  BranchSwitcher,
  CheckpointMarker,
  ImageThumb,
  JumpToLatest,
  MessageActions,
  ReplyMeta,
  StreamRail,
  ThinkingIndicator,
  CacheBreakDialog,
} from "@/components/Messages";
import { Dialog, Tooltip } from "@/components/ui/overlay";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut, useShortcutLabel } from "@/lib/useShortcut";
import { COMPACT, useMedia } from "@/lib/useMedia";
import { toast } from "@/components/ui/toast";
import { imageTokens } from "@/convex/lib/images";
import type { Effort } from "@/convex/lib/effort";
import type { MessageImage } from "@/convex/lib/images";
import {
  MODE_MAX_TOKENS,
  OUTPUT_MODES,
  type OutputMode,
} from "@/convex/lib/outputModes";
import Markdown, { CopyButton } from "@/components/Markdown";
import { api } from "@/convex/_generated/api";
import { estimateTokens, tokens, usd } from "@/lib/format";
import { useStoredChoice, useStoredFlag } from "@/lib/storedFlag";
import { useCacheState } from "@/lib/useCacheState";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

// Provider errors arrive without a final period; the charge note follows them.
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

// Pin a message so it's never folded into a summary (spec phase 6). Once condensed, fixed.
function PinButton({
  id,
  pinned,
  locked,
}: {
  id: Id<"messages">;
  pinned: boolean;
  locked: boolean;
}) {
  const setPinned = useMutation(api.condense.setPinned);
  const label = locked
    ? pinned
      ? "Pinned: kept verbatim after the summary"
      : "Condensed: folded into the summary"
    : pinned
      ? "Unpin"
      : "Pin: never fold into a summary";
  return (
    <IconButton
      icon={pinned ? <IconPinFilled /> : <IconPin />}
      label={label}
      size="sm"
      disabled={locked}
      aria-pressed={pinned}
      onClick={() => void setPinned({ messageId: id, pinned: !pinned })}
    />
  );
}

function UserMessage({
  id,
  text,
  images,
  pinned,
  pinLocked,
  siblingIds,
  busy,
  onType,
  breakCost,
  confirmAbove,
  mode,
  highlighted,
  editRequest,
}: {
  editRequest: number | null; // bumped when ↑ in an empty composer asks to edit this message
  mode: OutputMode;
  highlighted: boolean;
  id: Id<"messages">;
  text: string;
  pinned: boolean;
  pinLocked: boolean;
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
  const [confirming, setConfirming] = useState(false);
  const begin = () => {
    setConfirming(false);
    setDraft(text);
    setEditing(true);
  };
  // Above the owner's threshold, editing asks first (spec phase 3, cache-break warning).
  const requestEdit = () =>
    breakCost !== null && breakCost > confirmAbove ? setConfirming(true) : begin();
  const [seenRequest, setSeenRequest] = useState(editRequest);
  if (editRequest !== seenRequest) {
    setSeenRequest(editRequest);
    if (editRequest !== null && !busy && !editing) requestEdit();
  }
  const save = () =>
    draft.trim() && void edit({ messageId: id, content: draft, mode }).then(() => setEditing(false));

  return (
    <article
      id={`m-${id}`}
      className={cn("tc-turn tc-turn-user", highlighted && "tc-hl")}
    >
      {editing ? (
        <form
          className="tc-edit-card"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        >
          <UiTextarea
            label="Edit message"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              onType();
            }}
            rows={3}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            {breakCost !== null && (
              <span className="tc-mono text-mono-sm text-foreground-muted">
                Breaks the cache · ~{usd(breakCost)} to rewrite
              </span>
            )}
            <span className="flex-1" />
            <UiButton variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </UiButton>
            <UiButton type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
              Save and send
            </UiButton>
          </div>
        </form>
      ) : (
        <>
          {images && images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {images.map((image, i) => (
                <ImageThumb key={i} index={i} {...image} />
              ))}
            </div>
          )}
          <div className="tc-user-bubble">{text}</div>
          <MessageActions>
            <BranchSwitcher ids={siblingIds} current={id} />
            {breakCost !== null && (
              <Tooltip content="Editing forks the thread here, so everything after the system prompt is written to the cache again">
                <span className="tc-mono px-1 text-mono-xs text-foreground-subtle">
                  breaks cache · +{usd(breakCost)}
                </span>
              </Tooltip>
            )}
            <CopyButton text={text} />
            <IconButton
              icon={<IconPencil />}
              label="Edit"
              size="sm"
              disabled={busy}
              onClick={requestEdit}
            />
            <PinButton id={id} pinned={pinned} locked={pinLocked} />
          </MessageActions>
        </>
      )}
      {breakCost !== null && (
        <CacheBreakDialog
          open={confirming}
          extraMicroUsd={breakCost}
          action={{ verb: "Editing this message", confirm: "Edit anyway" }}
          body="Editing forks the thread here, so everything after the system prompt is written to the cache again. Continuing keeps the cache."
          onConfirm={begin}
          onCancel={() => setConfirming(false)}
        />
      )}
    </article>
  );
}

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

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: Id<"threads"> }>();
  const thread = useQuery(api.chat.getThread, { threadId });
  // A search hit to open (spec phase 7): /t/<thread>?m=<message>.
  const target = useSearchParams().get("m") as Id<"messages"> | null;
  const [highlighted, setHighlighted] = useState<Id<"messages"> | null>(null);
  const switchBranch = useMutation(api.chat.switchBranch);
  const switchedFor = useRef<Id<"messages"> | null>(null);
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
  // A one-off "reply with" model for the next send only, tied to its thread (spec phase 7).
  const [replyWith, setReplyWith] = useState<{
    threadId: string;
    model: ModelChoice;
  } | null>(null);
  const providers = useQuery(api.providers.list);
  const threadModel = thread && {
    providerId: thread.providerId,
    modelId: thread.modelId,
  };
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

  // Continue a cut-off reply: an ordinary next turn (5.5 models don't allow prefill).
  const continueReply = () => {
    setAtBottom(true);
    return send({ threadId, content: "Continue.", mode }).catch(() => {});
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const last = thread?.messages.at(-1);
  const streaming = last?.status === "streaming";

  // ⌘⇧C copies the last finished reply on this branch.
  useShortcut(SHORTCUTS.copyLastReply, () => {
    const reply = thread?.messages.findLast((m) => m.role === "assistant" && m.status !== "streaming" && m.text);
    if (reply)
      void navigator.clipboard.writeText(reply.text).then(() => toast({ title: "Copied the last reply" }));
  });
  const toBottom = () =>
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  // Follow new text only while the reader is at the bottom, so scrolling up to read isn't yanked back.
  useEffect(() => {
    if (atBottom) toBottom();
  }, [last?.text, thread?.messages.length, atBottom]);

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
  const renderMessage = (m: NonNullable<typeof thread>["messages"][number]) =>
    m.role === "user" ? (
      <UserMessage
        key={m._id}
        id={m._id}
        text={m.text}
        images={m.images}
        pinned={m.pinned}
        pinLocked={m.pinLocked}
        siblingIds={m.siblingIds}
        busy={streaming}
        onType={markActive}
        breakCost={breakCosts.get(m._id) ?? null}
        confirmAbove={settings?.cacheBreakConfirmMicroUsd ?? 100_000}
        mode={mode}
        highlighted={highlighted === m._id}
        editRequest={editTarget?.id === m._id ? editTarget.n : null}
      />
    ) : (
      <article
        key={m._id}
        id={`m-${m._id}`}
        className={cn("tc-turn tc-assistant", highlighted === m._id && "tc-hl")}
        data-streaming={m.status === "streaming" ? "true" : undefined}
      >
        {m.status === "streaming" && m.text && <StreamRail />}
        {m.status === "streaming" && !m.text && <ThinkingIndicator />}
        {m.text && <Markdown text={m.text} />}
        {m.status === "error" && (
          <ErrorState
            title="Reply failed"
            actions={
              <UiButton
                size="sm"
                icon={<IconRefresh />}
                disabled={streaming}
                onClick={() => void retry({ messageId: m._id, mode })}
              >
                Retry
              </UiButton>
            }
          >
            {sentence(m.error ?? "Something went wrong")}
            {!m.usage && " Nothing was charged."}
          </ErrorState>
        )}
        {m.status === "streaming" ? (
          m.text && (
            <p className="tc-mono text-mono-sm text-foreground-subtle">
              ~{tokens(estimateTokens(m.text))} out
            </p>
          )
        ) : (
          <div className="tc-msg-foot">
            <BranchSwitcher ids={m.siblingIds} current={m._id} />
            {m.usage && (
              <ReplyMeta
                messageId={m._id}
                model={m.modelName ?? m.model ?? ""}
                effort={m.effort}
                costMicroUsd={m.costMicroUsd}
                usage={m.usage}
              />
            )}
            {m.status === "stopped" && <Badge>Stopped</Badge>}
            {m.truncated && (
              <Badge tone="warning" dot>
                Hit the output limit
              </Badge>
            )}
            {m.pinned && <Badge tone="accent">Pinned</Badge>}
            <span className="flex-1" />
            <MessageActions shown={m._id === last?._id}>
              <CopyButton text={m.text} />
              <IconButton
                icon={<IconRefresh />}
                label="Retry"
                size="sm"
                disabled={streaming}
                onClick={() => void retry({ messageId: m._id, mode })}
              />
              <ModelMenu
                title="Retry with"
                threadId={threadId}
                maxOutputTokens={MODE_MAX_TOKENS[mode]}
                retryOf={m._id}
                onPick={(model) =>
                  void retry({
                    messageId: m._id,
                    mode,
                    model:
                      threadModel && sameModel(model, threadModel)
                        ? undefined
                        : model,
                  })
                }
                trigger={
                  <UiButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={<IconArrowsExchange />}
                    disabled={streaming}
                    aria-label="Retry with another model"
                    title="Retry with another model"
                  />
                }
              />
              <PinButton id={m._id} pinned={m.pinned} locked={m.pinLocked} />
            </MessageActions>
          </div>
        )}
        {m.truncated && m._id === last?._id && (
          <div className="flex items-center gap-2.5">
            <UiButton variant="outline" size="sm" icon={<IconPlayerPlay />} onClick={() => void continueReply()}>
              Continue
            </UiButton>
            <span className="tc-mono text-mono-sm text-foreground-muted">reuses the cached prefix</span>
          </div>
        )}
      </article>
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
              expiresAt={thread.cacheExpiresAt}
              keepaliveScheduled={thread.keepaliveScheduled}
              lastActiveAt={thread.lastActiveAt}
              onOpen={() => openInspector("cache")}
            />
          )}
          <span className="flex-1" />
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
              </div>
            </div>
            {!atBottom && <JumpToLatest onClick={toBottom} />}
          </div>
          <Composer
            streaming={streaming}
            onStop={() => last && void stop({ messageId: last._id })}
            onType={markActive}
            onDraftChange={setDraft}
            onEditLast={streaming ? undefined : editLast}
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
                {threadModel && (
                  <ModelMenu
                    title="Reply with, for this message only"
                    threadId={threadId}
                    hotkey
                    draftTokens={
                      estimateTokens(draft) +
                      draftImages.reduce((sum, i) => sum + imageTokens(i), 0)
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
                  // A per-message effort change waits for the thread's own model.
                  effort: oneOff ? undefined : (pendingEffort ?? undefined),
                  images: images.length ? images : undefined,
                  model: oneOff ?? undefined,
                });
                if (oneOff) setReplyWith(null);
                else setPendingEffort(null);
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
          open={inspectorShown}
          compact={compact}
          onClose={() => (compact ? setSheetOpen(false) : setInspectorOpen(false))}
          closeKbd={inspectorKbd}
        />
      </div>
    </ChatShell>
  );
}
