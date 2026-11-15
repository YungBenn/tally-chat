"use client";

import { IconArrowLeft, IconX } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { estimateTokens, tokens, usd } from "@/lib/format";
import { useCacheState } from "@/lib/useCacheState";
import { cn } from "@/lib/utils";

type Prices = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} | null;
type State = "cached" | "to write" | "provider" | "fresh";

const STATE_LABEL: Record<State, string> = {
  cached: "cached",
  "to write": "to write",
  provider: "provider",
  fresh: "fresh",
};
const priceFor = (state: State, p: NonNullable<Prices>) =>
  state === "cached"
    ? p.cacheRead
    : state === "to write"
      ? p.cacheWrite
      : p.input;
const money = (perToken: number | undefined, n: number) =>
  perToken === undefined ? "—" : usd(Math.round(perToken * n * 1e6));

function Row({
  label,
  value,
  state,
  cost,
  title,
}: {
  label: string;
  value: string;
  state?: string;
  cost?: string;
  title?: string;
}) {
  // Layer rows have four columns (tokens, state, cost); figure rows put their value at the end.
  if (state === undefined) {
    return (
      <div
        className="flex items-baseline justify-between gap-2 py-0.5"
        title={title}
      >
        <span className="truncate text-muted-foreground">{label}</span>
        <span>{value}</span>
      </div>
    );
  }
  return (
    <div
      className="grid grid-cols-[1fr_auto_4.5rem_4.5rem] items-baseline gap-x-2 py-0.5"
      title={title}
    >
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
      <span className="text-right text-muted-foreground">{state}</span>
      <span className="text-right">{cost ?? ""}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

// The thread's context window by layer and its money (spec phase 3, S9). Counts measured by
// the provider show plainly; estimates carry `~`.
export function InspectorBody({
  threadId,
  draft,
}: {
  threadId: Id<"threads">;
  draft: string;
}) {
  const data = useQuery(api.inspector.get, { threadId });
  const state = useCacheState(
    data
      ? data.cache
      : { expiresAt: null, keepaliveScheduled: false, lastActiveAt: null },
  );
  if (!data)
    return (
      <p className="text-sm text-muted-foreground">
        {data === null ? "This thread was deleted." : "Loading…"}
      </p>
    );

  const { cache, layers, next, thread } = data;
  const historyState: State = !cache.managed
    ? "provider"
    : state.state === "cold"
      ? "to write"
      : "cached";
  const draftTokens = estimateTokens(draft);
  const p = next.prices;
  // $0 from calls that have no price isn't free: say unknown unless something was priced.
  const known = (micro: number) =>
    micro === 0 && thread.unpricedCalls > 0 ? "unknown" : usd(micro);

  return (
    <div className="flex flex-col gap-6 font-mono text-xs tabular-nums">
      <Section title="Context window">
        {layers.map((l) => (
          <Row
            key={l.kind}
            label={l.label}
            value={`${l.estimated ? "~" : ""}${tokens(l.tokens)}`}
            state={STATE_LABEL[historyState]}
            cost={p ? money(priceFor(historyState, p), l.tokens) : "—"}
          />
        ))}
        <Row
          label="next message"
          value={`~${tokens(draftTokens)}`}
          state={STATE_LABEL.fresh}
          cost={p ? money(p.input, draftTokens) : "—"}
        />
        <p
          data-inspector-section="cache"
          className="pt-1 font-sans text-[11px] leading-4 text-muted-foreground"
        >
          {!cache.managed
            ? `This provider caches on its own; its last reply read ${tokens(cache.lastReadTokens ?? 0)} tokens from cache.`
            : historyState === "cached"
              ? `Cache ${state.state === "keepalive" ? "kept alive" : "warm"}: your next send reads the history at the cache price.`
              : "Cache cold: your next send writes the history to the cache again."}
          {cache.managed &&
            ` Prices are for the ${cache.ttl === "1h" ? "1-hour" : "5-minute"} cache.`}
        </p>
      </Section>

      <Section title="This thread">
        <Row
          label="total"
          value={known(thread.costMicroUsd)}
          title="Every call in this thread: replies, title and keepalives"
        />
        <Row
          label="cache upkeep"
          value={known(thread.upkeepMicroUsd)}
          title="Keepalive spend"
        />
        <Row
          label="cache hit rate"
          value={
            thread.hitRate === null
              ? "—"
              : `${Math.round(thread.hitRate * 100)}%`
          }
          title="Replies only"
        />
        <Row
          label="cache saved"
          value={p ? usd(thread.savedMicroUsd) : "unknown"}
          title="Read discount minus write premiums, minus cache upkeep. Can be negative."
        />
        <Row label="reasoning" value={tokens(thread.reasoningTokens)} />
        {data.effort && (
          <Row
            label="effort"
            value={data.effort}
            title="Sent as output_config.effort on every request"
          />
        )}
        {thread.unpricedCalls > 0 && (
          <p className="pt-1 font-sans text-[11px] text-muted-foreground">
            {thread.unpricedCalls} call
            {thread.unpricedCalls === 1 ? " has" : "s have"} no price, so these
            totals are a lower bound.
          </p>
        )}
        {!p && (
          <p className="pt-1 font-sans text-[11px] text-muted-foreground">
            This model has no price; costs are unknown.
          </p>
        )}
      </Section>
    </div>
  );
}

// One reply's breakdown: where its cost came from and what caching saved on it.
function TurnView({
  messageId,
  onBack,
}: {
  messageId: Id<"messages">;
  onBack: () => void;
}) {
  const turn = useQuery(api.inspector.turn, { messageId });
  const back = (
    <button
      className="mb-3 flex items-center gap-1 font-sans text-xs text-muted-foreground hover:text-foreground"
      onClick={onBack}
    >
      <IconArrowLeft className="size-3.5" /> Back to the thread
    </button>
  );
  if (turn === undefined) return back;
  if (turn === null)
    return (
      <>
        {back}
        <p className="text-sm text-muted-foreground">
          No usage was recorded for this reply.
        </p>
      </>
    );
  const u = turn.usage;
  return (
    <div className="font-mono text-xs tabular-nums">
      {back}
      <Section
        title={`This reply · ${turn.model}${turn.effort ? ` · ${turn.effort} effort` : ""}`}
      >
        <Row label="uncached input" value={tokens(u.inputTokens)} />
        <Row label="cache read" value={tokens(u.cacheReadTokens)} />
        <Row label="cache write 5m" value={tokens(u.cacheWriteTokens5m)} />
        <Row label="cache write 1h" value={tokens(u.cacheWriteTokens1h)} />
        <Row label="output" value={tokens(u.outputTokens)} />
        <Row
          label="reasoning"
          value={tokens(u.reasoningTokens)}
          title="Included in output, billed at the output price"
        />
        <div className="my-1 border-t border-border" />
        <Row
          label="cost"
          value={
            turn.costMicroUsd === null ? "unknown" : usd(turn.costMicroUsd)
          }
        />
        <Row
          label="cache saved"
          value={
            turn.savedMicroUsd === null ? "unknown" : usd(turn.savedMicroUsd)
          }
          title="Read discount minus write premiums, against paying the input price for the same tokens"
        />
      </Section>
    </div>
  );
}

// A right rail on desktop (its open state remembered per device) and a bottom sheet on phones
// (opened only on request, so it never covers the chat on load).
export default function Inspector({
  threadId,
  draft,
  railOpen,
  sheetOpen,
  onCloseRail,
  onCloseSheet,
  turnId,
  onBack,
}: {
  threadId: Id<"threads">;
  draft: string;
  turnId: Id<"messages"> | null; // a reply to show on its own, from its metadata line
  onBack: () => void;
  railOpen: boolean;
  sheetOpen: boolean;
  onCloseRail: () => void;
  onCloseSheet: () => void;
}) {
  const content = turnId ? (
    <TurnView messageId={turnId} onBack={onBack} />
  ) : (
    <InspectorBody threadId={threadId} draft={draft} />
  );
  const header = (onClose: () => void) => (
    <div className="flex items-center justify-between pb-4">
      <h2 className="text-sm font-semibold">Inspector</h2>
      <button
        className="icon-action"
        aria-label="Close inspector"
        title="Close inspector (⌘I)"
        onClick={onClose}
      >
        <IconX />
      </button>
    </div>
  );
  return (
    <>
      {railOpen && (
        <aside
          aria-label="Inspector"
          className="hidden w-88 shrink-0 overflow-y-auto border-l border-border bg-surface-muted px-4 py-4 md:block"
        >
          {header(onCloseRail)}
          {content}
        </aside>
      )}
      {sheetOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            aria-label="Close inspector"
            className="absolute inset-0 bg-[var(--primitive-backdrop)]"
            onClick={onCloseSheet}
          />
          <aside
            aria-label="Inspector"
            className={cn(
              "absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface px-4 pt-3 pb-6",
            )}
          >
            <div
              className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong"
              aria-hidden
            />
            {header(onCloseSheet)}
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
