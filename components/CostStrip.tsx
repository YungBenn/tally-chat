"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MODE_MAX_TOKENS, type OutputMode } from "@/convex/lib/outputModes";
import { imageTokens } from "@/convex/lib/images";
import { estimateTokens, usd } from "@/lib/format";
import { nextSendMicroUsd } from "@/lib/nextSend";
import { useCacheState } from "@/lib/useCacheState";

const NO_CACHE = {
  expiresAt: null,
  keepaliveScheduled: false,
  lastActiveAt: null,
};

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

const money = (micro: number | null) =>
  micro === null ? "cost unknown" : `~${usd(micro)} next`;

function Strip({ parts, onOpen }: { parts: string[]; onOpen?: () => void }) {
  const text = parts.join(" · ");
  const className =
    "mt-1.5 block w-full truncate px-3 text-left font-mono text-xs leading-5 text-muted-foreground tabular-nums";
  return onOpen ? (
    <button
      type="button"
      className={`${className} hover:text-foreground`}
      title="Open the inspector"
      onClick={onOpen}
    >
      {text}
    </button>
  ) : (
    <p className={className}>{text}</p>
  );
}

// One line under the composer: roughly what the next send costs, the cache status and the
// thread's hit rate (spec phase 3). Clicking opens the inspector.
export default function CostStrip({
  threadId,
  draft,
  draftImages,
  mode,
  onOpen,
}: {
  threadId: Id<"threads">;
  draft: string;
  draftImages?: { width: number; height: number }[];
  mode: OutputMode;
  onOpen: () => void;
}) {
  const data = useQuery(api.inspector.get, { threadId });
  const state = useCacheState(data?.cache ?? NO_CACHE);
  const settled = useDebounced(draft);
  if (!data) return null;
  const { cache, next, thread } = data;
  const history = !cache.managed
    ? "provider"
    : state.state === "cold"
      ? "cold"
      : "warm";
  const cost = nextSendMicroUsd({
    prices: next.prices,
    history,
    prefixTokens: next.prefixTokens,
    draftTokens: estimateTokens(settled) + imagesTokens(draftImages),
    // A reply can't run past the chosen mode's limit.
    expectedOutputTokens:
      next.expectedOutputTokens === null
        ? null
        : Math.min(next.expectedOutputTokens, MODE_MAX_TOKENS[mode]),
  });
  const cacheLabel = !cache.managed
    ? "provider caches"
    : state.state === "keepalive"
      ? "cache kept alive"
      : `cache ${state.state}`;
  const hit =
    thread.hitRate === null ? [] : [`${Math.round(thread.hitRate * 100)}% hit`];
  return <Strip parts={[money(cost), cacheLabel, ...hit]} onOpen={onOpen} />;
}

// On a new thread there's no history yet: the system prompt and the draft go out as fresh input.
export function NewThreadCostStrip({
  providerId,
  modelId,
  draft,
  draftImages,
}: {
  providerId: Id<"providers">;
  modelId: string;
  draft: string;
  draftImages?: { width: number; height: number }[];
}) {
  const data = useQuery(api.inspector.newThread, { providerId, modelId });
  const settled = useDebounced(draft);
  if (!data) return null;
  const cost = nextSendMicroUsd({
    prices: data.prices,
    history: "cold",
    prefixTokens: 0,
    draftTokens:
      data.systemTokens + estimateTokens(settled) + imagesTokens(draftImages),
    expectedOutputTokens: null,
  });
  return <Strip parts={[money(cost), "new thread"]} />;
}
