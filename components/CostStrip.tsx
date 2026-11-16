"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { CacheGlyph, useCacheTemp } from "@/components/CacheStatus";
import { Kbd } from "@/components/ui/feedback";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MODE_MAX_TOKENS, type OutputMode } from "@/convex/lib/outputModes";
import { imageTokens } from "@/convex/lib/images";
import { estimateTokens, usd } from "@/lib/format";
import { nextSendMicroUsd } from "@/lib/nextSend";
import { rollCells } from "@/lib/rolling";
import { useWebSearch } from "@/components/WebSearch";
import { SEARCH_TOKENS_ESTIMATE } from "@/convex/lib/webSearch";

const NO_CACHE = { expiresAt: null, keepaliveScheduled: false, lastActiveAt: null };

// The draft, settled for a moment, so the estimate doesn't recompute on every keystroke.
function useDebounced<T>(value: T, ms = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const imagesTokens = (images?: { width: number; height: number }[]) =>
  (images ?? []).reduce((sum, i) => sum + imageTokens(i), 0);

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Each digit rolls to its value in a fixed-width column (tabular figures), so nothing jitters. */
export function RollingNumber({ value }: { value: string }) {
  return (
    <span className="tc-roll" role="text" aria-label={value}>
      {rollCells(value).map((c) =>
        "digit" in c ? (
          <span key={c.key} className="tc-roll-d" aria-hidden>
            <span style={{ transform: `translateY(${-c.digit * 1.5}em)` }}>
              {DIGITS.map((d) => (
                <b key={d}>{d}</b>
              ))}
            </span>
          </span>
        ) : (
          <span key={c.key} aria-hidden>
            {c.char}
          </span>
        ),
      )}
    </span>
  );
}

function Strip({
  cost,
  cache,
  hit,
  onOpen,
}: {
  cost: number | null;
  cache: React.ReactNode;
  hit?: number | null;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="tc-cost-left">
        {cost === null ? (
          <span>cost unknown</span>
        ) : (
          <>
            <strong>
              ~<RollingNumber value={usd(cost)} />
            </strong>
            <span>next</span>
          </>
        )}
        <span className="sep">·</span>
        {cache}
        {hit != null && (
          <>
            <span className="sep">·</span>
            <span className={hit > 0 ? "hit" : undefined}>{Math.round(hit * 100)}% hit</span>
          </>
        )}
      </span>
      <span className="tc-cost-keys">
        <Kbd>↵</Kbd> send <Kbd>⇧↵</Kbd> newline
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" className="tc-cost" aria-live="polite" title="Open the inspector" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="tc-cost" aria-live="polite">
      {body}
    </div>
  );
}

function CacheLabel({
  cache,
}: {
  cache: { managed: boolean; expiresAt: number | null; keepaliveScheduled: boolean; lastActiveAt: number | null };
}) {
  const { temp, remaining, keptAlive } = useCacheTemp(cache.managed ? cache : NO_CACHE);
  if (!cache.managed) return <span>provider caches</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <CacheGlyph temp={temp} remaining={remaining} />
      {keptAlive ? "cache kept alive" : `cache ${temp}`}
    </span>
  );
}

// One line under the composer: roughly what the next send costs, the cache status and the
// thread's hit rate (spec phase 3). Clicking opens the inspector.
export default function CostStrip({
  threadId,
  draft,
  draftImages,
  draftDocTokens = 0,
  mode,
  onOpen,
}: {
  threadId: Id<"threads">;
  draft: string;
  draftImages?: { width: number; height: number }[];
  draftDocTokens?: number; // attached documents' text
  mode: OutputMode;
  onOpen: () => void;
}) {
  const data = useQuery(api.inspector.get, { threadId });
  const { temp } = useCacheTemp(data?.cache ?? NO_CACHE);
  const settled = useDebounced(draft);
  const search = useWebSearch().on;
  if (!data) return <div className="tc-cost" aria-hidden />;
  const { cache, next, thread } = data;
  const cost = nextSendMicroUsd({
    prices: next.prices,
    history: !cache.managed ? "provider" : temp === "cold" ? "cold" : "warm",
    prefixTokens: next.prefixTokens,
    draftTokens: estimateTokens(settled) + imagesTokens(draftImages) + draftDocTokens + (search ? SEARCH_TOKENS_ESTIMATE : 0),
    // A reply can't run past the chosen mode's limit.
    expectedOutputTokens:
      next.expectedOutputTokens === null ? null : Math.min(next.expectedOutputTokens, MODE_MAX_TOKENS[mode]),
  });
  return <Strip cost={cost} cache={<CacheLabel cache={cache} />} hit={thread.hitRate} onOpen={onOpen} />;
}

// On a new thread there's no history yet: the system prompt and the draft go out as fresh input.
export function NewThreadCostStrip({
  providerId,
  modelId,
  draft,
  draftImages,
  draftDocTokens = 0,
}: {
  providerId: Id<"providers">;
  modelId: string;
  draft: string;
  draftImages?: { width: number; height: number }[];
  draftDocTokens?: number; // attached documents' text
}) {
  const data = useQuery(api.inspector.newThread, { providerId, modelId });
  const settled = useDebounced(draft);
  const search = useWebSearch().on;
  if (!data) return <div className="tc-cost" aria-hidden />;
  const cost = nextSendMicroUsd({
    prices: data.prices,
    history: "cold",
    prefixTokens: 0,
    draftTokens:
      data.systemTokens + estimateTokens(settled) + imagesTokens(draftImages) + draftDocTokens + (search ? SEARCH_TOKENS_ESTIMATE : 0),
    expectedOutputTokens: null,
  });
  return <Strip cost={cost} cache={<span>new thread</span>} />;
}
