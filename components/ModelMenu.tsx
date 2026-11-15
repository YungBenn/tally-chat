"use client";

import { Menu } from "@base-ui/react/menu";
import { IconCheck } from "@tabler/icons-react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export type ModelChoice = { providerId: Id<"providers">; modelId: string };
export type ModelEntry = ModelChoice & { name: string; thread: boolean };

export const sameModel = (a: ModelChoice, b: ModelChoice) =>
  a.providerId === b.providerId && a.modelId === b.modelId;

// A one-off model choice (spec phase 7, cheaper reply): "reply with" in the composer and
// "Retry with…" on a reply. The thread's own model is marked; picking never changes the thread.
export default function ModelMenu({
  trigger,
  title,
  entries,
  selected,
  onPick,
  onOpenChange,
}: {
  trigger: React.ReactElement<Record<string, unknown>>;
  title: string;
  entries: ModelEntry[];
  selected?: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Menu.Root onOpenChange={(open) => onOpenChange?.(open)}>
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
            className="max-h-[min(24rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] origin-[var(--transform-origin)] overflow-y-auto rounded-[var(--primitive-radius-item)] p-1 outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-xs text-muted-foreground">
              {title}
            </p>
            {entries.map((e) => (
              <Menu.Item
                key={`${e.providerId}|${e.modelId}`}
                onClick={() =>
                  onPick({ providerId: e.providerId, modelId: e.modelId })
                }
                className={cn(
                  "flex min-h-9 cursor-default items-center gap-2 rounded-[calc(var(--primitive-radius-item)-2px)] px-2.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-primitive-surface-hover",
                )}
              >
                <span className="grid size-4 shrink-0 place-items-center text-foreground [&_svg]:size-4">
                  {selected && sameModel(e, selected) && <IconCheck />}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.thread && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    thread
                  </span>
                )}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
