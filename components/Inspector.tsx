"use client";

import {
  IconAlertTriangle,
  IconArrowsMinimize,
  IconClock,
  IconHistory,
  IconInfoCircle,
  IconPencil,
  IconSettings,
  IconTool,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useRef, useState } from "react";
import { CacheGlyph, useCacheTemp } from "@/components/CacheStatus";
import { useThreadCache } from "@/lib/useCacheState";
import { ThinkingIndicator } from "@/components/Messages";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/feedback";
import { Dialog, Sheet } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { imageTokens } from "@/convex/lib/images";
import { ctxScale } from "@/lib/scale";
import { estimateTokens, tokens, usd } from "@/lib/format";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useWebSearch } from "@/components/WebSearch";
import { DATE_TAG_TOKENS_ESTIMATE } from "@/convex/lib/dateTag";
import { SEARCH_TOKENS_ESTIMATE } from "@/convex/lib/webSearch";

type State = "cached" | "write" | "provider" | "fresh";
const BADGE: Record<State, { tone?: BadgeTone; label: string }> = {
  cached: { tone: "cached", label: "cached" },
  write: { tone: "write", label: "to write" },
  provider: { label: "provider" },
  fresh: { tone: "fresh", label: "fresh" },
};
const ICON = { tools: IconTool, system: IconSettings, checkpoint: IconArrowsMinimize, turns: IconHistory, next: IconPencil };

type Layer = { key: string; icon: keyof typeof ICON; name: string; tokens: number; estimated: boolean; state: State; price: string };

/** The context window as one bar under a ruler; segments differ by texture (solid, hatched, outlined). */
function ContextBar({ layers, selected }: { layers: Layer[]; selected: number }) {
  const used = layers.reduce((s, l) => s + l.tokens, 0);
  const scale = ctxScale(used);
  const fmt = (n: number) => (n >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : String(n));
  return (
    <div>
      <div className="tc-ctx">
        <div className="tc-ctx-ruler" aria-hidden>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} style={{ left: `${f * 100}%` }}>
              {fmt(scale * f)}
            </span>
          ))}
        </div>
        <div className="tc-ctx-minor" aria-hidden />
        <div
          className="tc-ctx-bar"
          role="img"
          aria-label={layers.map((l) => `${l.name} ${tokens(l.tokens)} tokens ${BADGE[l.state].label}`).join(", ")}
        >
          {layers.map((l, i) => (
            <m.div
              layout
              transition={transition.layout}
              key={l.key}
              className={cn("tc-ctx-seg", i === selected && "holo-border holo-vivid")}
              data-state={l.state === "provider" ? "cached" : l.state}
              data-selected={i === selected ? "true" : undefined}
              style={{ width: `${(l.tokens / scale) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="tc-ctx-legend">
        <span>
          <i className="tc-swatch" data-state="cached" />
          cached
        </span>
        <span>
          <i className="tc-swatch" data-state="write" />
          to be written
        </span>
        <span>
          <i className="tc-swatch" data-state="fresh" />
          fresh
        </span>
      </div>
    </div>
  );
}

/** Layer rows as a listbox: ↑ ↓ move the selection, which lights its segment in the bar. */
function LayerList({ layers, selected, onSelect }: { layers: Layer[]; selected: number; onSelect: (i: number) => void }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + layers.length) % layers.length;
    onSelect(n);
    refs.current[n]?.focus();
  };
  return (
    <div role="listbox" aria-label="Context layers" className="flex flex-col">
      {layers.map((l, i) => {
        const Icon = ICON[l.icon];
        return (
          <div
            key={l.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="option"
            aria-selected={i === selected}
            tabIndex={i === selected ? 0 : -1}
            className={cn("tc-layer", i === selected && "holo-border holo-default")}
            data-selected={i === selected ? "true" : undefined}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i + (e.key === "ArrowDown" ? 1 : -1));
              }
            }}
          >
            <span className="tc-layer-name">
              <Icon size={14} stroke={1.5} className="shrink-0 text-foreground-subtle" />
              <span className="truncate">{l.name}</span>
            </span>
            <Badge tone={BADGE[l.state].tone}>{BADGE[l.state].label}</Badge>
            <span className="tc-num">
              {l.estimated ? "~" : ""}
              {tokens(l.tokens)}
            </span>
            <span className="tc-num" style={{ color: "var(--foreground)" }}>
              {l.price}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Figure({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: string }) {
  return (
    <div className="tc-figure" title={title}>
      <span>{label}</span>
      <span className="tc-mono" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

// Condense now (spec phase 6): the estimate first, a dialog above the owner's cache-break
// threshold, then the running, held and failed states.
function Condense({
  threadId,
  estimate,
  state,
}: {
  threadId: Id<"threads">;
  estimate: { costMicroUsd: number | null; paybackTurns: number | null } | null;
  state: { state: string; inTokens?: number; paybackTurns?: number | null; failure?: string };
}) {
  const condenseNow = useMutation(api.condense.condenseNow);
  const settings = useQuery(api.settings.get);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const cost = estimate?.costMicroUsd ?? null;
  const never = estimate?.paybackTurns != null && estimate.paybackTurns >= 1000;
  const payback =
    estimate?.paybackTurns == null
      ? null
      : never
        ? "never pays back"
        : `pays off in ${Math.max(1, Math.round(estimate.paybackTurns))} replies`;
  const run = async () => {
    setAsking(false);
    setError(null);
    try {
      await condenseNow({ threadId });
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : "Could not condense");
    }
  };
  const start = () =>
    cost !== null && cost > (settings?.cacheBreakConfirmMicroUsd ?? 100_000) ? setAsking(true) : void run();
  const failure = error ?? (state.state === "failed" ? state.failure : null);
  return (
    <section className="flex flex-col gap-2.5 border-t border-border pt-4">
      <h2 className="text-subheading">Condense</h2>
      <p className="text-body-sm text-foreground-muted">
        Replaces older turns with a summary written by the thread's own model.{" "}
        {state.state === "off"
          ? "Automatic condensing is off."
          : state.state === "held"
            ? `Automatic condensing waits: it would pay for itself only after ~${Math.max(1, Math.round(state.paybackTurns ?? 0))} turns.`
            : state.state === "waiting" && state.inTokens
              ? `Next automatic check in ~${tokens(state.inTokens)} tokens.`
              : ""}
      </p>
      {state.state === "condensing" ? (
        <div className="tc-fade-in flex items-center gap-3">
          <Button variant="outline" loading>
            Condensing
          </Button>
          <ThinkingIndicator label="Condensing" />
        </div>
      ) : failure ? (
        <div className="tc-fade-in flex flex-col gap-2.5 rounded-popover bg-danger-soft p-3 text-danger">
          <p className="flex items-start gap-2 text-body-sm">
            <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
            <span>
              <strong>Could not condense.</strong> {failure}. The thread is unchanged.
            </span>
          </p>
          {estimate && (
            <div>
              <Button size="sm" onClick={start}>
                Retry
              </Button>
            </div>
          )}
        </div>
      ) : estimate && !never ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" icon={<IconArrowsMinimize />} onClick={start}>
            Condense now
          </Button>
          <span className="tc-mono text-mono-sm text-foreground-muted">
            {[cost !== null && `~${usd(cost)} once`, payback].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : (
        estimate && (
          <div className="tc-fade-in flex flex-col items-start gap-2">
            <Button variant="outline" icon={<IconArrowsMinimize />} disabled>
              Condense now
            </Button>
            <p className="flex items-start gap-1.5 text-body-sm text-foreground-muted">
              <IconInfoCircle size={14} stroke={1.5} className="mt-[0.1875rem] shrink-0" />
              Condensing now would never pay for itself. A thread near the model&apos;s context window condenses
              anyway.
            </p>
          </div>
        )
      )}
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        icon={<IconArrowsMinimize size={18} stroke={1.5} />}
        title={`Condensing now costs ~${cost === null ? "" : usd(cost)}.`}
        description={`The summary plus writing the new prefix to the cache${payback ? `; it ${payback}` : ""}.`}
        actions={
          <>
            <Button onClick={() => setAsking(false)}>Not now</Button>
            <Button variant="primary" onClick={() => void run()}>
              Condense anyway
            </Button>
          </>
        }
      />
    </section>
  );
}

// The thread's context window by layer and its money (spec phase 3, S9). Counts measured by
// the provider show plainly; estimates carry `~`.
function InspectorBody({
  threadId,
  draft,
  draftImages,
  draftDocTokens = 0,
  selected,
  setSelected,
}: {
  threadId: Id<"threads">;
  draft: string;
  draftImages?: { width: number; height: number }[];
  draftDocTokens?: number;
  selected: number | null; // held by Inspector, so it survives the column/sheet switch
  setSelected: (i: number) => void;
}) {
  const search = useWebSearch().on;
  const data = useQuery(api.inspector.get, { threadId });
  const cache = useCacheTemp(useThreadCache(threadId));
  if (!data)
    return <p className="text-body-sm text-foreground-muted">{data === null ? "This thread was deleted." : "Loading…"}</p>;

  const { layers, next, thread } = data;
  const managed = data.cache.managed;
  const history: State = !managed ? "provider" : cache.temp === "cold" ? "write" : "cached";
  const p = next.prices;
  const perToken = (s: State) => (!p ? undefined : s === "cached" ? p.cacheRead : s === "write" ? p.cacheWrite : p.input);
  const money = (s: State, n: number) => {
    const t = perToken(s);
    return t === undefined ? "—" : usd(Math.round(t * n * 1e6));
  };
  const draftTokens =
    estimateTokens(draft) +
    (draftImages ?? []).reduce((sum, i) => sum + imageTokens(i), 0) +
    draftDocTokens +
    DATE_TAG_TOKENS_ESTIMATE +
    (search ? SEARCH_TOKENS_ESTIMATE : 0);
  const rows: Layer[] = [
    ...layers.map((l) => ({
      key: l.kind,
      icon: l.kind,
      name: l.label.charAt(0).toUpperCase() + l.label.slice(1),
      tokens: l.tokens,
      estimated: l.estimated,
      state: history,
      price: money(history, l.tokens),
    })),
    { key: "next", icon: "next" as const, name: "Next message", tokens: draftTokens, estimated: true, state: "fresh" as const, price: money("fresh", draftTokens) },
  ];
  // The latest layer that changes is selected by default: the write, else the next message.
  const sel = selected ?? (history === "write" ? rows.length - 2 : rows.length - 1);
  const used = rows.reduce((s, l) => s + l.tokens, 0);
  // $0 from calls that have no price isn't free: say unknown unless something was priced.
  const known = (micro: number) => (micro === 0 && thread.unpricedCalls > 0 ? "unknown" : usd(micro));
  const note = !managed
    ? `This provider caches on its own; its last reply read ${tokens(data.cache.lastReadTokens ?? 0)} tokens from cache.`
    : cache.temp === "cold"
      ? "Your next send writes the history to the cache again."
      : cache.keptAlive
        ? "Keepalive on · refreshes just before expiry while you're here."
        : cache.temp === "cooling"
          ? `Expires in ${cache.time} unless you send.`
          : "Your next send reads the history at the cache price.";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5" data-inspector-section="cache">
        <p className="text-overline text-foreground-muted uppercase">Cache</p>
        {managed && (
          <div>
            <span className={cn("tc-cache", cache.temp === "warm" && "holo-border holo-subtle")} data-state={cache.temp}>
              <CacheGlyph temp={cache.temp} remaining={cache.remaining} />
              cache {cache.temp}
              {cache.time && <span className="tc-num">{cache.time}</span>}
            </span>
          </div>
        )}
        <p className="flex items-start gap-2 text-body-sm text-foreground-muted">
          <IconClock size={14} stroke={1.5} className="mt-[0.1875rem] shrink-0" />
          <span>
            {note}
            {managed && ` Prices are for the ${data.cache.ttl === "1h" ? "1-hour" : "5-minute"} cache.`}
          </span>
        </p>
      </section>

      <section className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className="flex-1 text-subheading">Context window</h2>
          <span className="tc-mono text-mono-sm text-foreground-muted">{tokens(used)} tokens</span>
        </div>
        <ContextBar layers={rows} selected={sel} />
        <LayerList layers={rows} selected={sel} onSelect={setSelected} />
        {!p && <p className="text-caption text-foreground-subtle">This model has no price; costs are unknown.</p>}
      </section>

      <section className="flex flex-col">
        <h2 className="mb-2 text-subheading">This thread</h2>
        <Figure label="Total spend" value={known(thread.costMicroUsd)} title="Every call in this thread: replies, title, keepalives, condensing and searches" />
        <Figure label="Cache upkeep" value={known(thread.upkeepMicroUsd)} title="Keepalive spend" />
        <Figure
          label="Cache hit rate"
          value={thread.hitRate === null ? "—" : `${Math.round(thread.hitRate * 100)}%`}
          title="Replies only"
        />
        <Figure
          label="Cache saved"
          value={p ? `${thread.savedMicroUsd > 0 ? "+" : ""}${usd(thread.savedMicroUsd)}` : "unknown"}
          tone={!p ? undefined : thread.savedMicroUsd < 0 ? "var(--savings-negative)" : "var(--savings-positive)"}
          title="Read discount minus write premiums, minus cache upkeep. Can be negative."
        />
        <Figure label="Reasoning" value={tokens(thread.reasoningTokens)} />
        {data.effort && <Figure label="Effort" value={data.effort} title="Sent as output_config.effort on every request" />}
        {thread.unpricedCalls > 0 && (
          <p className="pt-2 text-caption text-foreground-subtle">
            {thread.unpricedCalls} call{thread.unpricedCalls === 1 ? " has" : "s have"} no price, so these totals are a lower
            bound.
          </p>
        )}
      </section>

      <Condense threadId={threadId} estimate={data.condenseNow} state={data.condense} />
    </div>
  );
}

function Panel({
  onClose,
  closeKbd,
  children,
}: {
  onClose: () => void;
  closeKbd?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-header shrink-0 items-center border-b border-border pr-2 pl-5">
        <p className="flex-1 text-overline text-foreground-muted uppercase">Inspector</p>
        <IconButton icon={<IconX />} label="Close inspector" kbd={closeKbd} size="sm" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  );
}

/**
 * The inspector (design system: Inspector): a 360px column that opens by animating its width,
 * or a bottom sheet under 1200px.
 */
export default function Inspector({
  threadId,
  draft,
  draftImages,
  draftDocTokens = 0,
  open,
  compact,
  onClose,
  closeKbd,
}: {
  threadId: Id<"threads">;
  draft: string;
  draftImages?: { width: number; height: number }[];
  draftDocTokens?: number;
  open: boolean;
  compact: boolean;
  onClose: () => void;
  closeKbd?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const body = (
    <InspectorBody
      threadId={threadId}
      draft={draft}
      draftImages={draftImages}
      draftDocTokens={draftDocTokens}
      selected={selected}
      setSelected={setSelected}
    />
  );
  if (compact)
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()} side="bottom" title="Inspector">
        <div className="mx-auto h-full w-full max-w-[35rem] min-h-0">
          <Panel onClose={onClose}>{body}</Panel>
        </div>
      </Sheet>
    );
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.aside
          aria-label="Inspector"
          className="shrink-0 overflow-hidden border-l border-border"
          initial={{ width: 0 }}
          animate={{ width: "22.5rem" }}
          exit={{ width: 0 }}
          transition={transition.layout}
        >
          <div className="h-full w-inspector">
            <Panel onClose={onClose} closeKbd={closeKbd}>
              {body}
            </Panel>
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  );
}
