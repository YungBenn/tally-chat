"use client";

import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconPhoto,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, HoloGradient } from "@/components/ui/feedback";
import { Dialog, Popover } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { tokens, totalInput, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Usage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens5m: number;
  cacheWriteTokens1h: number;
  outputTokens: number;
  reasoningTokens: number;
};

/** Copy, retry, edit, pin...: hidden until the message is hovered or holds focus (or `shown`). */
export function MessageActions({
  shown,
  className,
  children,
}: {
  shown?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Message actions"
      className={cn("tc-msg-actions", !shown && "tc-reveal", className)}
    >
      {children}
    </div>
  );
}

/** `< 2/3 >` between versions of a message; the count slides the way you move. */
export function BranchSwitcher({ ids, current }: { ids: Id<"messages">[]; current: Id<"messages"> }) {
  const switchBranch = useMutation(api.chat.switchBranch);
  const [dir, setDir] = useState<"next" | "prev" | undefined>();
  // The slide follows the version actually shown, so ⌥←/⌥→ animate too.
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setDir(ids.indexOf(current) > ids.indexOf(shown) ? "next" : "prev");
  }
  if (ids.length < 2) return null;
  const i = ids.indexOf(current);
  const go = (d: 1 | -1) => void switchBranch({ messageId: ids[i + d] });
  return (
    <span className="tc-branch" role="group" aria-label={`Version ${i + 1} of ${ids.length}`}>
      <button type="button" aria-label="Previous version" disabled={i <= 0} onClick={() => go(-1)}>
        <IconChevronLeft size={14} stroke={1.5} />
      </button>
      <span className="tc-branch-count" data-dir={dir}>
        <span key={current}>
          {i + 1}/{ids.length}
        </span>
      </span>
      <button type="button" aria-label="Next version" disabled={i >= ids.length - 1} onClick={() => go(1)}>
        <IconChevronRight size={14} stroke={1.5} />
      </button>
    </span>
  );
}

/** Tally ticks rise in sequence, then the slash; seconds since it appeared, in mono. */
export function ThinkingIndicator({ label = "Thinking" }: { label?: string }) {
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div className="tc-thinking" role="status" aria-live="polite">
      <span className="tc-thinking-lines" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className="holo-fill" />
        ))}
      </span>
      <span>{label}</span>
      <span className="tc-num">{s}s</span>
    </div>
  );
}

/** The thin holo rail left of a reply while it streams. */
export function StreamRail() {
  const id = useId();
  return (
    <svg className="tc-stream-rail" width={2} height="100%" preserveAspectRatio="none" viewBox="0 0 2 100" aria-hidden>
      <defs>
        <HoloGradient id={id} x1={0} y1={0} x2={0} y2={100} />
      </defs>
      <rect width={2} height={100} rx={1} fill={`url(#${id})`} />
    </svg>
  );
}

function CostBreakdown({ messageId }: { messageId: Id<"messages"> }) {
  const turn = useQuery(api.inspector.turn, { messageId });
  if (turn === undefined) return <div className="h-40" />;
  if (turn === null) return <p className="text-body-sm text-foreground-muted">No usage was recorded for this reply.</p>;
  const u = turn.usage;
  const rows = [
    { tone: "cached" as const, chip: "cached", label: "Cache read", tok: u.cacheReadTokens },
    { tone: "write" as const, chip: "written", label: "Cache write", tok: u.cacheWriteTokens5m + u.cacheWriteTokens1h },
    { tone: "fresh" as const, chip: "fresh", label: "Fresh input", tok: u.inputTokens },
    { tone: undefined, chip: "output", label: "Output", tok: u.outputTokens },
  ];
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex min-h-7 items-center gap-2">
          <Badge tone={r.tone}>{r.chip}</Badge>
          <span className="flex-1 text-body-sm text-foreground-muted">{r.label}</span>
          <span className="tc-mono text-mono-sm text-foreground">{tokens(r.tok)}</span>
        </div>
      ))}
      <div className="my-1 h-px bg-border" />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-label">Total</span>
        <span className="tc-mono text-mono-sm font-medium">
          {turn.costMicroUsd === null ? "cost unknown" : usd(turn.costMicroUsd)}
        </span>
      </div>
      {turn.savedMicroUsd !== null && (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-body-sm text-foreground-muted">Cache saved</span>
          <span
            className="tc-mono text-mono-sm"
            style={{ color: turn.savedMicroUsd < 0 ? "var(--savings-negative)" : "var(--savings-positive)" }}
          >
            {turn.savedMicroUsd < 0 ? "" : "+"}
            {usd(turn.savedMicroUsd)}
          </span>
        </div>
      )}
      <p className="text-caption text-foreground-subtle">
        {turn.model}
        {turn.effort ? ` · effort ${turn.effort}` : ""}
        {u.reasoningTokens > 0
          ? ` · ${tokens(u.reasoningTokens)} thinking is included in output, billed at the output price`
          : " · thinking is included in output, billed at the output price"}
      </p>
    </div>
  );
}

/** One mono line under a reply: model (effort) · cost · input (cached share) · output. Opens the breakdown. */
export function ReplyMeta({
  messageId,
  model,
  effort,
  costMicroUsd,
  usage,
}: {
  messageId: Id<"messages">;
  model: string;
  effort?: string | null;
  costMicroUsd?: number;
  usage: Usage;
}) {
  const input = totalInput(usage);
  const cached = input > 0 ? Math.round((usage.cacheReadTokens / input) * 100) : 0;
  const cost = costMicroUsd === undefined ? "cost unknown" : usd(costMicroUsd);
  return (
    <Popover
      title={`This reply · ${cost}`}
      side="top"
      className="w-[340px] max-w-[calc(100vw-32px)]"
      trigger={
        <button type="button" className="tc-meta" aria-label={`Cost breakdown: ${cost}`}>
          <span className="model">{model}</span>
          {effort && <span>({effort})</span>}
          <span className="sep">·</span>
          <span>{cost}</span>
          <span className="sep">·</span>
          <span>
            {tokens(input)} in{usage.cacheReadTokens > 0 && <span className="cached"> ({cached}% cached)</span>}
          </span>
          <span className="sep">·</span>
          <span>{tokens(usage.outputTokens)} out</span>
        </button>
      }
    >
      <CostBreakdown messageId={messageId} />
    </Popover>
  );
}

/** Where older turns were condensed: a pill between dashed rules that opens the summary. */
export function CheckpointMarker({
  turns,
  open,
  onToggle,
}: {
  turns: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="tc-checkpoint" role="separator">
      <button type="button" className="tc-checkpoint-pill" aria-expanded={open} onClick={onToggle}>
        <IconArrowsMinimize size={13} stroke={1.5} />
        {turns === 1 ? "Turn 1 condensed" : `Turns 1-${turns} condensed`}
        <span className="tc-num">{open ? "hide" : "show"}</span>
      </button>
    </div>
  );
}

/**
 * Before an edit or effort change that rewrites the cache (design system: CacheBreakWarning).
 * States the extra cost first; focus starts on the cheaper path, and Esc takes it.
 */
export function CacheBreakDialog({
  open,
  extraMicroUsd,
  action,
  body,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  extraMicroUsd: number;
  action: { verb: string; confirm: string }; // "Editing this message", "Edit anyway"
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      icon={<IconAlertTriangle size={18} stroke={1.5} />}
      title={`${action.verb} costs ~${usd(extraMicroUsd)} more than continuing.`}
      description={body}
      initialFocus={safe}
      actions={
        <>
          <Button ref={safe} onClick={onCancel}>
            Continue instead
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {action.confirm}
          </Button>
        </>
      }
    />
  );
}

/** A sent image in a user message: the picture, or a framed placeholder with its size. */
export function ImageThumb({
  url,
  width,
  height,
  index,
}: {
  url: string | null;
  width: number;
  height: number;
  index: number;
}) {
  if (!url)
    return (
      <div className="tc-thumb tc-thumb-empty" role="img" aria-label={`Attached image ${index + 1}, ${width} by ${height}`}>
        <IconPhoto size={20} stroke={1.5} />
        <span className="tc-mono text-mono-xs">
          {width}×{height}
        </span>
      </div>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="tc-thumb" title="Open full size">
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, already downscaled */}
      <img src={url} alt={`Attached image ${index + 1}`} width={width} height={height} />
      <span className="tc-thumb-meta tc-mono">
        {width}×{height}
      </span>
    </a>
  );
}

/** Shown while the reader is scrolled up: one click back to the end. */
export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <div className="tc-jump">
      <Button size="sm" icon={<IconArrowDown />} onClick={onClick}>
        Jump to latest
      </Button>
    </div>
  );
}
