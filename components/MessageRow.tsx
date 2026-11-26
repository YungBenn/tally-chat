"use client";

import {
  IconArrowsExchange,
  IconBolt,
  IconFileText,
  IconMessages,
  IconPencil,
  IconPin,
  IconPinFilled,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { createContext, memo, use, useState } from "react";
import Markdown, { CopyButton } from "@/components/Markdown";
import {
  BranchSwitcher,
  CacheBreakDialog,
  ImageThumb,
  MessageActions,
  ReplyMeta,
  StreamRail,
  ThinkingIndicator,
} from "@/components/Messages";
import ModelMenu, { sameModel, type ModelChoice } from "@/components/ModelMenu";
import { ApprovalPrompt, ToolCallRow } from "@/components/ToolCalls";
import { SearchSources } from "@/components/WebSearch";
import { Button as UiButton, IconButton } from "@/components/ui/button";
import { Badge, ErrorState } from "@/components/ui/feedback";
import { Textarea as UiTextarea } from "@/components/ui/fields";
import { MountOnOpen, Popover, Tooltip } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Effort } from "@/convex/lib/effort";
import { outputCeiling, type OutputMode } from "@/convex/lib/outputModes";
import { estimateTokens, tokens, usd } from "@/lib/format";
import { isOptimistic } from "@/lib/optimisticSend";
import { cn } from "@/lib/utils";

export type ThreadMessage = NonNullable<FunctionReturnType<typeof api.chat.getThread>>["messages"][number];

/**
 * Thread-wide values every row reads. They change rarely (mode, settings, the thread's model), so
 * keep the value stable between renders: a new value re-renders every row.
 */
export const ThreadRowContext = createContext<{
  threadId: Id<"threads">;
  mode: OutputMode;
  threadModel: ModelChoice | null;
  confirmAbove: number; // micro-dollars: a cache-breaking edit above this asks first
  onType: () => void;
  onContinue: () => void;
} | null>(null);

/**
 * Whether a reply is in progress on the branch. It flips on every send and finish, so only the
 * buttons it disables read it (through `Busy`), never a whole row.
 */
export const ThreadBusyContext = createContext(false);

function Busy({ children }: { children: (busy: boolean) => React.ReactNode }) {
  return children(use(ThreadBusyContext));
}

// A trigger the menu hands its props to (Base UI's render prop), so it can't be a render function.
function IdleButton(props: React.ComponentProps<typeof UiButton>) {
  return <UiButton {...props} disabled={use(ThreadBusyContext)} />;
}

function useThreadRow() {
  const ctx = use(ThreadRowContext);
  if (!ctx) throw new Error("A message row renders inside ThreadRowContext");
  return ctx;
}

// Provider errors arrive without a final period; the charge note follows them.
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/**
 * One message on the branch. Memoized: give it the same message object (see useStableMessages) and
 * primitives, and it skips re-rendering when another message changes.
 */
const MessageRow = memo(function MessageRow({
  message,
  highlighted,
  isLast,
  breakCost,
  editRequest,
}: {
  message: ThreadMessage;
  highlighted: boolean;
  isLast: boolean;
  breakCost: number | null; // user messages: extra micro-dollars editing here costs, when it breaks the cache
  editRequest: number | null; // user messages: bumped when ↑ in an empty composer asks to edit this one
}) {
  return message.role === "user" ? (
    <UserMessage m={message} highlighted={highlighted} breakCost={breakCost} editRequest={editRequest} />
  ) : (
    <AssistantMessage m={message} highlighted={highlighted} isLast={isLast} />
  );
});
export default MessageRow;

// "Retry with" another model. Mounts its picker on first press: a long thread has one per reply.
function RetryWithMenu({ messageId }: { messageId: Id<"messages"> }) {
  const { threadId, mode, threadModel } = useThreadRow();
  const retry = useMutation(api.chat.retry);
  const trigger = (
    <IdleButton
      variant="ghost"
      size="sm"
      iconOnly
      icon={<IconArrowsExchange />}
      aria-label="Retry with another model"
      title="Retry with another model"
    />
  );
  return (
    <MountOnOpen trigger={trigger}>
      <ModelMenu
        title="Retry with"
        threadId={threadId}
        maxOutputTokens={outputCeiling(mode)}
        retryOf={messageId}
        defaultOpen
        onPick={(model) =>
          void retry({ messageId, mode, model: threadModel && sameModel(model, threadModel) ? undefined : model })
        }
        trigger={trigger}
      />
    </MountOnOpen>
  );
}

// "Retry at higher effort": one level up, for this reply alone. Mounts on first press and prices the
// retry on the thread's own model only while open (the same estimate as "Retry with").
function RetryHigherEffort({ messageId, effort }: { messageId: Id<"messages">; effort: Effort }) {
  const { threadId, mode } = useThreadRow();
  const retry = useMutation(api.chat.retry);
  const trigger = (
    <IdleButton
      variant="ghost"
      size="sm"
      iconOnly
      icon={<IconBolt />}
      aria-label="Retry at higher effort"
      title="Retry at higher effort"
    />
  );
  return (
    <MountOnOpen trigger={trigger}>
      <Popover title="Retry at higher effort" side="top" defaultOpen trigger={trigger}>
        <RetryHigherEstimate
          threadId={threadId}
          messageId={messageId}
          effort={effort}
          onRetry={() => void retry({ messageId, mode, higherEffort: true })}
        />
      </Popover>
    </MountOnOpen>
  );
}

function RetryHigherEstimate({
  threadId,
  messageId,
  effort,
  onRetry,
}: {
  threadId: Id<"threads">;
  messageId: Id<"messages">;
  effort: Effort;
  onRetry: () => void;
}) {
  const { mode } = useThreadRow();
  const [openedAt] = useState(() => Date.now());
  const rows = useQuery(api.inspector.modelEstimates, {
    threadId,
    now: openedAt,
    draftTokens: 0,
    maxOutputTokens: outputCeiling(mode, effort),
    retryOf: messageId,
  });
  const cost = rows?.find((r) => r.thread)?.costMicroUsd;
  return (
    <UiButton variant="outline" size="sm" icon={<IconBolt />} onClick={onRetry}>
      Retry at {effort} effort
      <span className="tc-mono text-mono-sm text-foreground-muted">
        {rows === undefined ? "Pricing…" : cost == null ? "cost unknown" : `~${usd(cost)}`}
      </span>
    </UiButton>
  );
}

// Pin a message so it's never folded into a summary (spec phase 6). Once condensed, fixed.
function PinButton({ id, pinned, locked }: { id: Id<"messages">; pinned: boolean; locked: boolean }) {
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
      disabled={locked || isOptimistic(id)} // not saved yet
      aria-pressed={pinned}
      onClick={() => void setPinned({ messageId: id, pinned: !pinned })}
    />
  );
}

function UserMessage({
  m,
  highlighted,
  breakCost,
  editRequest,
}: {
  m: ThreadMessage;
  highlighted: boolean;
  breakCost: number | null;
  editRequest: number | null;
}) {
  const { mode, confirmAbove, onType } = useThreadRow();
  const { _id: id, text, images, documents, search } = m;
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
  // The page only asks while no reply is in progress (edit-last is off while streaming).
  const [seenRequest, setSeenRequest] = useState(editRequest);
  if (editRequest !== seenRequest) {
    setSeenRequest(editRequest);
    if (editRequest !== null && !editing) requestEdit();
  }
  const save = () =>
    draft.trim() && void edit({ messageId: id, content: draft, mode }).then(() => setEditing(false));

  return (
    <article id={`m-${id}`} className={cn("tc-turn tc-turn-user", highlighted && "tc-hl")}>
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
          {documents && documents.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {documents.map((d, i) => {
                const body = (
                  <>
                    <span className="tc-attach-thumb">
                      {d.fromThreadId ? <IconMessages size={16} stroke={1.5} /> : <IconFileText size={16} stroke={1.5} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-48 truncate">{d.name}</span>
                      <small>~{tokens(d.tokens)} tok</small>
                    </span>
                  </>
                );
                // A mentioned thread links back to it (the copy sent is from when it was mentioned).
                return d.fromThreadId ? (
                  <Link key={i} href={`/t/${d.fromThreadId}`} className="tc-attach tc-attach-link" title={`Open ${d.name}`}>
                    {body}
                  </Link>
                ) : (
                  <span key={i} className="tc-attach">
                    {body}
                  </span>
                );
              })}
            </div>
          )}
          <div className="tc-user-bubble">{text}</div>
          {search && <SearchSources search={search} />}
          <MessageActions>
            <BranchSwitcher ids={m.siblingIds} current={id} />
            {breakCost !== null && (
              <Tooltip content="Editing forks the thread here, so everything after the system prompt is written to the cache again">
                <span className="tc-mono px-1 text-mono-xs text-foreground-subtle">
                  breaks cache · +{usd(breakCost)}
                </span>
              </Tooltip>
            )}
            <CopyButton text={text} />
            <Busy>
              {(busy) => <IconButton icon={<IconPencil />} label="Edit" size="sm" disabled={busy} onClick={requestEdit} />}
            </Busy>
            <PinButton id={id} pinned={m.pinned} locked={m.pinLocked} />
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

function AssistantMessage({ m, highlighted, isLast }: { m: ThreadMessage; highlighted: boolean; isLast: boolean }) {
  const { mode, onContinue } = useThreadRow();
  const retry = useMutation(api.chat.retry);
  const approveTools = useMutation(api.chat.approveTools);
  const streaming = m.status === "streaming";
  // A streaming step's text lives in its own row (ADR 0004): only this row subscribes, so a flush
  // re-renders this message alone. Null once the step ends, when the message holds the text.
  // An optimistic placeholder (ticket 08) has no stream yet, and its id must never reach the server.
  const live = useQuery(api.chat.streamingText, streaming && !isOptimistic(m._id) ? { messageId: m._id } : "skip");
  const text = (streaming ? live : null) ?? m.text;
  return (
    <article
      id={`m-${m._id}`}
      className={cn("tc-turn tc-assistant", highlighted && "tc-hl")}
      data-streaming={streaming ? "true" : undefined}
    >
      {streaming && text && <StreamRail />}
      {streaming && !text && !m.items?.some((i) => i.kind === "tool" && i.status === "running") && <ThinkingIndicator />}
      {m.items ? (
        <>
          {m.items.map((item, i) =>
            item.kind === "tool" && item.status === "waiting" ? null : item.kind === "text" ? ( // waiting calls show in the prompt below
              <Markdown key={i} text={item.text} />
            ) : (
              <ToolCallRow key={item.id} {...item} />
            ),
          )}
          {/* While it runs, text is the step still streaming; after, the items hold all of it. */}
          {streaming && text && <Markdown text={text} />}
        </>
      ) : (
        text && <Markdown text={text} />
      )}
      {m.status === "error" && (
        <ErrorState
          title="Reply failed"
          actions={
            <Busy>
              {(busy) => (
                <UiButton size="sm" icon={<IconRefresh />} disabled={busy} onClick={() => void retry({ messageId: m._id, mode })}>
                  Retry
                </UiButton>
              )}
            </Busy>
          }
        >
          {sentence(m.error ?? "Something went wrong")}
          {!m.usage && " Nothing was charged."}
        </ErrorState>
      )}
      {m.status === "waiting" && m.items && (
        <ApprovalPrompt
          calls={m.items.flatMap((i) => (i.kind === "tool" && i.status === "waiting" ? [i] : []))}
          onAnswer={(declined) => approveTools({ messageId: m._id, declined })}
        />
      )}
      {streaming || m.status === "waiting" ? (
        text && <p className="tc-mono text-mono-sm text-foreground-subtle">~{tokens(estimateTokens(text))} out</p>
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
              {m.hitStepLimit ? "Stopped after 10 steps" : m.approvalExpired ? "Approval timed out" : "Hit the output limit"}
            </Badge>
          )}
          {m.pinned && <Badge tone="accent">Pinned</Badge>}
          <span className="flex-1" />
          <MessageActions shown={isLast}>
            <CopyButton text={text} />
            <Busy>
              {(busy) => (
                <IconButton
                  icon={<IconRefresh />}
                  label="Retry"
                  size="sm"
                  disabled={busy}
                  onClick={() => void retry({ messageId: m._id, mode })}
                />
              )}
            </Busy>
            <RetryWithMenu messageId={m._id} />
            {m.retryEffort && <RetryHigherEffort messageId={m._id} effort={m.retryEffort} />}
            <PinButton id={m._id} pinned={m.pinned} locked={m.pinLocked} />
          </MessageActions>
        </div>
      )}
      {m.truncated && isLast && (
        <div className="flex items-center gap-2.5">
          <UiButton variant="outline" size="sm" icon={<IconPlayerPlay />} onClick={onContinue}>
            Continue
          </UiButton>
          <span className="tc-mono text-mono-sm text-foreground-muted">reuses the cached prefix</span>
        </div>
      )}
    </article>
  );
}
