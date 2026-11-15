"use client";

import { Menu } from "@base-ui/react/menu";
import { IconCheck } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usd } from "@/lib/format";

export type ModelChoice = { providerId: Id<"providers">; modelId: string };

export const sameModel = (a: ModelChoice, b: ModelChoice) =>
  a.providerId === b.providerId && a.modelId === b.modelId;

// A one-off model choice (spec phase 7, cheaper reply): "reply with" in the composer and
// "Retry with…" on a reply. Each model shows what this send would cost on it, priced on the
// server only while the list is open; the thread's own model is marked. Picking never changes
// the thread.
export default function ModelMenu({
  trigger,
  title,
  threadId,
  draftTokens = 0,
  maxOutputTokens,
  retryOf,
  selected,
  onPick,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  threadId: Id<"threads">;
  draftTokens?: number;
  maxOutputTokens: number;
  retryOf?: Id<"messages">;
  selected?: ModelChoice;
  onPick: (choice: ModelChoice) => void;
}) {
  // When the list opened: the thread's cache state is judged at that moment.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const rows = useQuery(
    api.inspector.modelEstimates,
    openedAt === null
      ? "skip"
      : { threadId, now: openedAt, draftTokens, maxOutputTokens, retryOf },
  );
  return (
    <Menu.Root onOpenChange={(open) => setOpenedAt(open ? Date.now() : null)}>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner
          className="z-30 outline-none"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={16}
        >
          <Menu.Popup
            data-surface="overlay"
            className="max-h-[min(24rem,var(--available-height))] w-[min(22rem,calc(100vw-2rem))] origin-[var(--transform-origin)] overflow-y-auto rounded-[var(--primitive-radius-item)] p-1 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">
              {title}
            </p>
            {rows === undefined && (
              <p className="px-2.5 py-2 text-sm text-muted-foreground">
                Pricing…
              </p>
            )}
            {rows?.map((r) => (
              <Menu.Item
                key={`${r.providerId}|${r.modelId}`}
                onClick={() =>
                  onPick({ providerId: r.providerId, modelId: r.modelId })
                }
                className="flex min-h-9 cursor-default items-center gap-2 rounded-[calc(var(--primitive-radius-item)-2px)] px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-primitive-surface-hover"
              >
                <span className="grid size-4 shrink-0 place-items-center text-foreground [&_svg]:size-4">
                  {selected && sameModel(r, selected) && <IconCheck />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  {r.thread && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      thread
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {r.costMicroUsd === null
                    ? "cost unknown"
                    : r.costMicroUsd === 0
                      ? "$0"
                      : `~${usd(r.costMicroUsd)}`}
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
