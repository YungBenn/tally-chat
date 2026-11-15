"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import BudgetBanner from "@/components/BudgetBanner";
import ChatShell from "@/components/ChatShell";
import Composer from "@/components/Composer";
import ModeControl from "@/components/ModeControl";
import {
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  type Effort,
} from "@/convex/lib/effort";
import type { OutputMode } from "@/convex/lib/outputModes";
import { NewThreadCostStrip } from "@/components/CostStrip";
import { NativeSelect } from "@/components/wensity/native-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function NewThread() {
  const providers = useQuery(api.providers.list);
  const createThread = useMutation(api.chat.createThread);
  const send = useMutation(api.chat.send);
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
  const [draft, setDraft] = useState("");
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
    <ChatShell
      header={
        options.length > 0 && (
          <>
            <NativeSelect
              aria-label="Model"
              selectSize="sm"
              fullWidth={false}
              value={selected ?? ""}
              onChange={(e) => setChoice(e.target.value)}
              options={options}
            />
            {anthropic && (
              <NativeSelect
                aria-label="Effort"
                title="How hard the model thinks. Fixed for the thread; higher costs more."
                selectSize="sm"
                fullWidth={false}
                value={effort}
                onChange={(e) => setEffort(e.target.value as Effort)}
                options={EFFORT_LEVELS.map((level) => ({
                  value: level,
                  label: `${level} effort`,
                }))}
              />
            )}
          </>
        )
      }
    >
      <div className="flex flex-1 flex-col justify-center overflow-y-auto pb-[10vh]">
        <div className="mb-6 flex flex-col items-center gap-4 px-4 text-center">
          <span className="grid size-10 place-items-center rounded-full border border-border bg-surface font-mono text-sm font-semibold">
            t
          </span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            What are we working on?
          </h1>
          {providers && options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              <Link
                href="/providers"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Add a provider
              </Link>{" "}
              to start a thread.
            </p>
          )}
        </div>
        <Composer
          disabled={!selected}
          onDraftChange={setDraft}
          controls={<ModeControl value={mode} onChange={setMode} />}
          banner={<BudgetBanner />}
          footer={
            selected && (
              <NewThreadCostStrip
                providerId={selected.split("|")[0] as Id<"providers">}
                modelId={selected.split("|")[1]}
                draft={draft}
              />
            )
          }
          canAttach={vision}
          onSend={async (text, images) => {
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
      </div>
    </ChatShell>
  );
}
