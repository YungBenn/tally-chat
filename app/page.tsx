"use client";

import { IconPlus, IconX } from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import BudgetBanner, { useSendingPaused } from "@/components/BudgetBanner";
import BrandMark from "@/components/BrandMark";
import ChatShell from "@/components/ChatShell";
import { EmptyState } from "@/components/ui/feedback";
import Composer from "@/components/Composer";
import ModeControl from "@/components/ModeControl";
import { SearchToggle, useWebSearch } from "@/components/WebSearch";
import { DEFAULT_EFFORT, type Effort } from "@/convex/lib/effort";
import type { MessageImage } from "@/convex/lib/images";
import type { OutputMode } from "@/convex/lib/outputModes";
import { NewThreadCostStrip } from "@/components/CostStrip";
import EffortControl from "@/components/EffortControl";
import { ModelPickerButton } from "@/components/ModelMenu";
import { Button as UiButton, IconButton } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/overlay";
import { SHORTCUTS } from "@/lib/shortcuts";
import { useShortcut } from "@/lib/useShortcut";
import { estimateTokens, usd } from "@/lib/format";
import { looksSimple, worthSuggesting } from "@/lib/modelSuggestion";
import { nextSendMicroUsd } from "@/lib/nextSend";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// A first message that looks simple, on a model several times the price of its provider's
// cheapest: offer the cheaper start (spec phase 7). Switch changes the picker; nothing is sent.
function StartCheaper({
  providerId,
  modelId,
  draft,
  imageCount,
  withDocuments,
  onSwitch,
}: {
  providerId: Id<"providers">;
  modelId: string;
  draft: string;
  imageCount: number;
  withDocuments: boolean; // reading documents is never "simple"
  onSwitch: (modelId: string) => void;
}) {
  const data = useQuery(api.inspector.newThread, { providerId, modelId });
  // Dismissed for this draft: it comes back once the box is cleared.
  const [dismissed, setDismissed] = useState(false);
  if (dismissed && !draft.trim()) setDismissed(false);
  const cheapest = data?.cheapest;
  if (
    dismissed ||
    !data ||
    !cheapest ||
    cheapest.modelId === modelId ||
    withDocuments ||
    !looksSimple(draft, imageCount) ||
    !worthSuggesting(data.prices, cheapest.prices)
  )
    return null;
  const firstTurn = (prices: typeof data.prices) =>
    nextSendMicroUsd({
      prices,
      history: "cold",
      prefixTokens: 0,
      draftTokens: data.systemTokens + estimateTokens(draft),
      expectedOutputTokens: null,
    });
  const cheap = firstTurn(cheapest.prices);
  const current = firstTurn(data.prices);
  return (
    <div role="status" className="tc-suggest">
      <span className="min-w-0 flex-1">
        Looks simple: start on{" "}
        <span className="font-medium text-foreground">{cheapest.name}</span>?{" "}
        <span className="tc-mono text-mono-sm">
          ~{usd(cheap ?? 0)} instead of ~{usd(current ?? 0)}
        </span>{" "}
        for this turn
      </span>
      <UiButton
        size="sm"
        variant="outline"
        onClick={() => onSwitch(cheapest.modelId)}
      >
        Switch
      </UiButton>
      <IconButton
        icon={<IconX />}
        label="Dismiss suggestion"
        size="sm"
        onClick={() => setDismissed(true)}
      />
    </div>
  );
}

// The new thread's model: grouped by provider, ⌘M opens it.
function NewThreadModelMenu({
  providers,
  selected,
  onPick,
}: {
  providers: {
    _id: Id<"providers">;
    name: string;
    models: { id: string; displayName: string; hidden?: boolean }[];
  }[];
  selected: string;
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useShortcut(SHORTCUTS.modelPicker, () => setOpen((o) => !o));
  const [pid, mid] = selected.split("|");
  const name =
    providers.find((p) => p._id === pid)?.models.find((m) => m.id === mid)
      ?.displayName ?? mid;
  const shown = providers.filter((p) => p.models.some((m) => !m.hidden));
  return (
    <Menu
      side="top"
      open={open}
      onOpenChange={setOpen}
      trigger={<ModelPickerButton name={name} aria-label={`Model: ${name}`} />}
      className="w-[min(20rem,calc(100vw-2rem))]"
    >
      <MenuLabel>Model for this thread</MenuLabel>
      {shown.map((p) => (
        <div key={p._id} role="group" aria-label={p.name}>
          {shown.length > 1 && <div className="tc-menu-group">{p.name}</div>}
          {p.models
            .filter((m) => !m.hidden)
            .map((m) => (
              <MenuItem
                key={m.id}
                check={selected === `${p._id}|${m.id}`}
                onClick={() => onPick(`${p._id}|${m.id}`)}
              >
                {m.displayName}
              </MenuItem>
            ))}
        </div>
      ))}
    </Menu>
  );
}

export default function NewThread() {
  const providers = useQuery(api.providers.list);
  const createThread = useMutation(api.chat.createThread);
  const send = useMutation(api.chat.send);
  const webSearch = useWebSearch();
  const router = useRouter();
  const options = (providers ?? []).flatMap((p) =>
    p.models
      .filter((m) => !m.hidden)
      .map((m) => ({
        value: `${p._id}|${m.id}`,
        label: `${p.name} · ${m.displayName}`,
      })),
  );
  const [choice, setChoice] = useState<string | null>(null);
  const paused = useSendingPaused();
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<MessageImage[]>([]);
  const [draftDocTokens, setDraftDocTokens] = useState(0);
  const [mode, setMode] = useState<OutputMode>("normal");
  const [effort, setEffort] = useState<Effort>(DEFAULT_EFFORT);
  const selected = choice ?? options[0]?.value;
  // Effort is an Anthropic-style setting (spec phase 4); other providers get no control.
  const anthropic =
    providers?.find((p) => p._id === selected?.split("|")[0])?.apiStyle ===
    "anthropic";
  const vision =
    providers
      ?.find((p) => p._id === selected?.split("|")[0])
      ?.models.find((m) => m.id === selected?.split("|")[1])?.vision === true;

  return (
    <ChatShell>
      <div className="tc-home tc-grid-bg">
        {providers && options.length === 0 ? (
          <EmptyState
            className="w-full max-w-lg"
            title="Add a provider to start"
            description="Connect Anthropic, OpenAI, OpenRouter, Ollama or any OpenAI-compatible API with your own key. Keys stay on your server."
            action={
              <Link
                href="/providers"
                className="tc-btn tc-btn-primary holo-border holo-sweep"
              >
                <IconPlus size={16} stroke={1.5} />
                Add a provider
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <BrandMark size={48} draw />
            <h1 className="mt-3 text-display">Start a thread</h1>
            <p className="text-body text-foreground-muted">
              Pick a model and effort. The estimate below updates as you type.
            </p>
          </div>
        )}
        {(!providers || options.length > 0) && (
          <Composer
            disabled={!selected}
            paused={paused}
            onDraftChange={setDraft}
            controls={
              selected &&
              providers && (
                <>
                  <NewThreadModelMenu
                    providers={providers}
                    selected={selected}
                    onPick={setChoice}
                  />
                  {anthropic && (
                    <EffortControl value={effort} onChange={setEffort} />
                  )}
                  <ModeControl value={mode} onChange={setMode} />
                  {webSearch.available && (
                    <SearchToggle on={webSearch.on} onChange={webSearch.setOn} />
                  )}
                </>
              )
            }
            banner={
              <>
                <BudgetBanner />
                {selected && (
                  <StartCheaper
                    providerId={selected.split("|")[0] as Id<"providers">}
                    modelId={selected.split("|")[1]}
                    draft={draft}
                    imageCount={draftImages.length}
                    withDocuments={draftDocTokens > 0}
                    onSwitch={(modelId) =>
                      setChoice(`${selected.split("|")[0]}|${modelId}`)
                    }
                  />
                )}
              </>
            }
            footer={
              selected && (
                <NewThreadCostStrip
                  providerId={selected.split("|")[0] as Id<"providers">}
                  modelId={selected.split("|")[1]}
                  draft={draft}
                  draftImages={draftImages}
                  draftDocTokens={draftDocTokens}
                />
              )
            }
            canAttach={vision}
            onImagesChange={setDraftImages}
            onDocumentsChange={setDraftDocTokens}
            onSend={async (text, images, documents) => {
              if (!selected) return;
              const [providerId, modelId] = selected.split("|");
              try {
                const threadId = await createThread({
                  providerId: providerId as Id<"providers">,
                  modelId,
                  effort: anthropic ? effort : undefined,
                });
                await send({
                  threadId,
                  content: text,
                  mode,
                  images: images.length ? images : undefined,
                  search: webSearch.on || undefined,
                  documents: documents.length ? documents : undefined,
                });
                router.push(`/t/${threadId}`);
              } catch (err) {
                throw new Error(
                  err instanceof ConvexError
                    ? String(err.data)
                    : "Could not send",
                );
              }
            }}
          />
        )}
      </div>
    </ChatShell>
  );
}
