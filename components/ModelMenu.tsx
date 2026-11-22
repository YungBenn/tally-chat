"use client";

import {
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconEye,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTool,
} from "@tabler/icons-react";
import { useMutation, useQueries, useQuery } from "convex/react";
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { useRef, useState } from "react";
import { Popover } from "@/components/ui/overlay";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usd } from "@/lib/format";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut } from "@/lib/useShortcut";
import { cn } from "@/lib/utils";

// useQuery that returns a failure instead of throwing it.
const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

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

/** One model in the picker. `hint` is right-aligned in mono (a price); `note` follows the name. */
export type PickerModel = ModelChoice & {
  name: string;
  provider: string;
  vision: boolean;
  tools: boolean;
  favorite: boolean;
  hint?: string;
  note?: string;
};

type View = "favorites" | "all" | Id<"providers">;

// A row index kept within 0..last. Outside ModelPicker because calling Math.max in two places
// there trips an internal React Compiler error.
const clampIndex = (i: number, last: number) => Math.min(Math.max(i, 0), last);

/**
 * The model picker: search, then Favorites, All or one provider, then the models.
 * The star on a row favorites it everywhere; Favorites is where the picker opens once any model has
 * a star. Typing searches every model whatever the tab. ↑↓ move, ↵ picks, the open model is checked.
 */
export function ModelPicker({
  trigger,
  title,
  open,
  onOpenChange,
  models,
  selected,
  onPick,
  loading = "Loading…",
  notice,
}: {
  trigger: React.ReactElement;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: PickerModel[] | undefined; // undefined while loading
  selected?: ModelChoice;
  onPick: (choice: ModelChoice) => void;
  loading?: string;
  notice?: React.ReactNode;
}) {
  const updateModel = useMutation(api.providers.updateModel);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<View | null>(null); // null: Favorites when there are any
  const [active, setActive] = useState<number | null>(null); // null: the selected model

  const all = models ?? [];
  const providers = [...new Map(all.map((m) => [m.providerId, m.provider]))];
  const view: View = tab ?? (all.some((m) => m.favorite) ? "favorites" : "all");
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((m) =>
    words.length
      ? words.every((w) => `${m.name} ${m.provider}`.toLowerCase().includes(w))
      : view === "all" || (view === "favorites" ? m.favorite : m.providerId === view),
  );
  const isSelected = (m: PickerModel) => !!selected && sameModel(m, selected);
  const current = clampIndex(active ?? shown.findIndex(isSelected), shown.length - 1);
  // The provider is clear from the tab; elsewhere each row names it.
  const showProvider = providers.length > 1 && (words.length > 0 || view === "favorites" || view === "all");

  const pick = (m: PickerModel) => {
    onPick({ providerId: m.providerId, modelId: m.modelId });
    onOpenChange(false);
  };
  const switchTab = (v: View) => {
    setTab(v);
    setQuery("");
    setActive(null);
    inputRef.current?.focus();
  };
  const tabs: { id: View; label: React.ReactNode; title: string }[] = [
    { id: "favorites", label: <IconStarFilled size={14} />, title: "Favorites" },
    { id: "all", label: "All", title: "All models" },
    ...(providers.length > 1 ? providers.map(([id, name]) => ({ id, label: name, title: name })) : []),
  ];

  return (
    <Popover
      trigger={trigger}
      side="top"
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setTab(null);
          setActive(null);
        }
      }}
      // Start in the search, except on touch screens, where that would pop up the keyboard.
      initialFocus={() => matchMedia("(pointer: coarse)").matches || inputRef.current}
      className="tc-mp"
    >
      <div className="tc-mp-head">
        <p className="tc-menu-label px-0! pt-0!">{title}</p>
        <label className="tc-mp-search">
          <IconSearch size={16} stroke={1.5} className="shrink-0 text-foreground-subtle" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search models"
            aria-label="Search models"
            role="combobox"
            aria-expanded
            aria-controls="tc-mp-list"
            aria-activedescendant={shown[current] ? `tc-mp-${current}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive(clampIndex(current + step, shown.length - 1));
              } else if (e.key === "Enter" && shown[current]) {
                e.preventDefault();
                pick(shown[current]);
              } else if (e.key === "Escape" && query) {
                e.stopPropagation(); // clear first; a second Esc closes
                setQuery("");
              }
            }}
          />
        </label>
        <div className="tc-mp-tabs" role="tablist" aria-label="Show">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={!words.length && view === t.id}
              aria-label={t.title}
              title={t.title}
              className="tc-mp-tab"
              onClick={() => switchTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id="tc-mp-list" role="listbox" aria-label="Models" className="tc-mp-list">
        {models === undefined ? (
          <p className="tc-mp-empty">{loading}</p>
        ) : shown.length === 0 ? (
          <p className="tc-mp-empty">
            {words.length
              ? "No models match."
              : view === "favorites"
                ? "Star a model to keep it here."
                : "No models."}
          </p>
        ) : (
          shown.map((m, i) => (
            <div
              key={`${m.providerId}|${m.modelId}`}
              id={`tc-mp-${i}`}
              role="option"
              aria-selected={isSelected(m)}
              data-active={i === current || undefined}
              className="tc-mp-row"
              onClick={() => pick(m)}
              onMouseMove={() => i !== current && setActive(i)}
              // The arrow keys move the active row; keep it in view.
              ref={(el) => {
                if (el && i === current && active !== null) el.scrollIntoView({ block: "nearest" });
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-body font-medium">{m.name}</span>
                  {m.note && <span className="shrink-0 text-caption text-foreground-subtle">{m.note}</span>}
                  {isSelected(m) && <IconCheck size={14} stroke={2} className="shrink-0 text-accent" aria-hidden />}
                </div>
                {showProvider && <div className="truncate text-caption text-foreground-subtle">{m.provider}</div>}
              </div>
              <span className="tc-mp-caps">
                {m.vision && (
                  <span title="Reads images" aria-label="Reads images">
                    <IconEye size={14} stroke={1.5} />
                  </span>
                )}
                {m.tools && (
                  <span title="Calls tools" aria-label="Calls tools">
                    <IconTool size={14} stroke={1.5} />
                  </span>
                )}
              </span>
              {m.hint && <span className="tc-num min-w-16 shrink-0 whitespace-nowrap text-right text-mono-xs text-foreground-muted">{m.hint}</span>}
              <button
                type="button"
                className="tc-mp-star"
                aria-pressed={m.favorite}
                aria-label={m.favorite ? `Unstar ${m.name}` : `Star ${m.name}`}
                title={m.favorite ? "Remove from favorites" : "Add to favorites"}
                onClick={(e) => {
                  e.stopPropagation();
                  setTab(view); // a first star mustn't switch the default tab to Favorites mid-browse
                  void updateModel({ providerId: m.providerId, modelId: m.modelId, favorite: !m.favorite });
                }}
              >
                {m.favorite ? <IconStarFilled size={14} /> : <IconStar size={14} stroke={1.5} />}
              </button>
            </div>
          ))
        )}
      </div>
      {notice && <p className="tc-mp-foot">{notice}</p>}
    </Popover>
  );
}

const price = (micro: number | null) =>
  micro === null ? "cost unknown" : micro === 0 ? "$0" : `~${usd(micro)}`;

// A one-off model choice (spec phase 7, cheaper reply): "reply with" in the composer and
// "Retry with…" on a reply. Each model shows what this send would cost on it, priced on the server
// only while the picker is open; the thread's own model is marked. Picking never changes the
// thread. `hotkey` lets ⌘M open it.
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
  defaultOpen = false,
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
  defaultOpen?: boolean; // mounted by a press (MountOnOpen): open right away
}) {
  // When the picker opened: the thread's cache state is judged at that moment.
  const [openedAt, setOpenedAt] = useState<number | null>(() => (defaultOpen ? Date.now() : null));
  const providers = useQuery(api.providers.list);
  // A failure stays inside the menu: useQuery would throw it to the thread page's error boundary.
  const estimates = useQueryWithStatus(
    api.inspector.modelEstimates,
    openedAt === null ? "skip" : { threadId, now: openedAt, draftTokens, maxOutputTokens, retryOf },
  );
  const allRows = estimates.data;
  // A thread that uses tools can only be answered by models that can call them.
  const tools = useQuery(api.chat.threadTools, openedAt === null ? "skip" : { threadId });
  const needTools = (tools?.picks.length ?? 0) > 0;
  const hidden = needTools ? (allRows?.filter((r) => !r.tools).length ?? 0) : 0;
  const rows = needTools ? allRows?.filter((r) => r.tools) : allRows;
  useShortcut(SHORTCUTS.modelPicker, () => setOpenedAt(openedAt === null ? Date.now() : null), !!hotkey);
  const models =
    rows &&
    providers &&
    rows.map((r): PickerModel => {
      const p = providers.find((p) => p._id === r.providerId);
      const m = p?.models.find((m) => m.id === r.modelId);
      const provider = p?.name ?? "";
      return {
        providerId: r.providerId,
        modelId: r.modelId,
        name: r.name.startsWith(`${provider} · `) ? r.name.slice(provider.length + 3) : r.name,
        provider,
        vision: m?.vision === true,
        tools: r.tools,
        favorite: m?.favorite === true,
        hint: price(r.costMicroUsd),
        note: r.thread ? "thread" : undefined,
      };
    });
  return (
    <ModelPicker
      trigger={trigger}
      title={title}
      open={openedAt !== null}
      onOpenChange={(open) => setOpenedAt(open ? Date.now() : null)}
      models={models}
      selected={selected}
      onPick={onPick}
      loading={estimates.isError ? "Couldn't price the models. Try again later." : "Pricing…"}
      notice={
        hidden > 0 &&
        `${hidden} ${hidden === 1 ? "model is" : "models are"} hidden: this thread uses tools they can't call.`
      }
    />
  );
}
