"use client";

import { IconChevronDown, IconCpu } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usd } from "@/lib/format";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut } from "@/lib/useShortcut";
import { cn } from "@/lib/utils";

export type ModelChoice = { providerId: Id<"providers">; modelId: string };

export const sameModel = (a: ModelChoice, b: ModelChoice) =>
  a.providerId === b.providerId && a.modelId === b.modelId;

/** The composer's model trigger: cpu icon, model name, chevron. `oneOff` marks a reply-with choice. */
export function ModelPickerButton({
  name,
  oneOff,
  className,
  ...rest
}: { name: string; oneOff?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn("tc-picker", oneOff && "tc-picker-on", className)} {...rest}>
      <IconCpu size={14} stroke={1.5} />
      <span className="tc-picker-name">{name}</span>
      <IconChevronDown size={12} stroke={1.5} />
    </button>
  );
}

const price = (micro: number | null) =>
  micro === null ? "cost unknown" : micro === 0 ? "$0" : `~${usd(micro)}`;

// A one-off model choice (spec phase 7, cheaper reply): "reply with" in the composer and
// "Retry with…" on a reply. Models are grouped by provider, each with what this send would cost
// on it, priced on the server only while the list is open; the thread's own model is marked.
// Picking never changes the thread. `hotkey` lets ⌘M open it.
export default function ModelMenu({
  trigger,
  title,
  threadId,
  draftTokens = 0,
  maxOutputTokens,
  retryOf,
  selected,
  onPick,
  hotkey,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  threadId: Id<"threads">;
  draftTokens?: number;
  maxOutputTokens: number;
  retryOf?: Id<"messages">;
  selected?: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  hotkey?: boolean;
}) {
  // When the list opened: the thread's cache state is judged at that moment.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const providers = useQuery(api.providers.list);
  const allRows = useQuery(
    api.inspector.modelEstimates,
    openedAt === null ? "skip" : { threadId, now: openedAt, draftTokens, maxOutputTokens, retryOf },
  );
  // A thread that uses tools can only be answered by models that can call them.
  const tools = useQuery(api.chat.threadTools, openedAt === null ? "skip" : { threadId });
  const needTools = (tools?.picks.length ?? 0) > 0;
  const hidden = needTools ? (allRows?.filter((r) => !r.tools).length ?? 0) : 0;
  const rows = needTools ? allRows?.filter((r) => r.tools) : allRows;
  useShortcut(SHORTCUTS.modelPicker, () => setOpenedAt(openedAt === null ? Date.now() : null), !!hotkey);
  const providerName = (id: Id<"providers">) => providers?.find((p) => p._id === id)?.name ?? "";
  const groups = [...new Set(rows?.map((r) => r.providerId))];
  return (
    <Menu
      trigger={trigger}
      side="top"
      open={openedAt !== null}
      onOpenChange={(open) => setOpenedAt(open ? Date.now() : null)}
      className="w-[min(22rem,calc(100vw-2rem))]"
    >
      <MenuLabel>{title}</MenuLabel>
      {rows === undefined && <p className="px-2 py-2 text-body-sm text-foreground-subtle">Pricing…</p>}
      {hidden > 0 && (
        <p className="px-2 pb-1 text-caption text-foreground-subtle">
          {hidden} {hidden === 1 ? "model is" : "models are"} hidden: this thread uses tools they can&apos;t call.
        </p>
      )}
      {groups.map((g) => (
        <div key={g} role="group" aria-label={providerName(g)}>
          {groups.length > 1 && <div className="tc-menu-group">{providerName(g)}</div>}
          {rows
            ?.filter((r) => r.providerId === g)
            .map((r) => (
              <MenuItem
                key={`${r.providerId}|${r.modelId}`}
                check={!!selected && sameModel(r, selected)}
                hint={price(r.costMicroUsd)}
                onClick={() => onPick({ providerId: r.providerId, modelId: r.modelId })}
              >
                {r.name.startsWith(`${providerName(g)} · `) ? r.name.slice(providerName(g).length + 3) : r.name}
                {r.thread && <span className="ml-1.5 text-caption text-foreground-subtle">thread</span>}
              </MenuItem>
            ))}
        </div>
      ))}
    </Menu>
  );
}
