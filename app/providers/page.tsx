"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import { Button } from "@/components/wensity/button";
import { Checkbox } from "@/components/wensity/checkbox";
import { Input } from "@/components/wensity/input";
import { NativeSelect } from "@/components/wensity/native-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const errorText = (err: unknown) =>
  err instanceof ConvexError ? String(err.data) : "Something went wrong";

export default function ProvidersPage() {
  const providers = useQuery(api.providers.list);

  return (
    <ChatShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Providers
          </h1>
          {providers?.map((p) => (
            <ProviderCard key={p._id} provider={p} />
          ))}
          {providers?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers yet. Add one to start chatting.
            </p>
          )}
          <AddProvider />
        </div>
      </div>
    </ChatShell>
  );
}

const STYLES = {
  anthropic: {
    label: "Anthropic",
    name: "My Anthropic",
    baseUrl: "https://api.anthropic.com",
  },
  "openai-compatible": {
    label: "OpenAI-compatible",
    name: "My OpenAI",
    baseUrl: "https://api.openai.com/v1",
  },
} as const;
type Style = keyof typeof STYLES;

function AddProvider() {
  const add = useAction(api.providerActions.add);
  const [style, setStyle] = useState<Style>("anthropic");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setSaving(true);
    setError(null);
    try {
      await add({
        name: String(form.get("name")),
        apiStyle: style,
        baseUrl: String(form.get("baseUrl")),
        apiKey: String(form.get("apiKey")),
        free: form.get("free") === "on",
      });
      formEl.reset();
    } catch (err) {
      setError(errorText(err));
    }
    setSaving(false);
  }

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Add a provider</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use an API key from your provider&apos;s developer console. A ChatGPT
          Plus or Claude Pro subscription is not an API key: API usage is billed
          separately, from the console.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <Input
          key={`name-${style}`}
          label="Name"
          name="name"
          defaultValue={STYLES[style].name}
          required
        />
        <NativeSelect
          label="API style"
          value={style}
          onChange={(e) => setStyle(e.target.value as Style)}
          options={Object.entries(STYLES).map(([value, { label }]) => ({
            value,
            label,
          }))}
        />
        <Input
          key={`url-${style}`}
          label="Base URL"
          containerClassName="sm:col-span-2"
          inputClassName="font-mono"
          name="baseUrl"
          defaultValue={STYLES[style].baseUrl}
          required
          hint={
            style === "openai-compatible"
              ? "Include the version path, e.g. https://openrouter.ai/api/v1 or http://192.168.1.20:11434/v1 for Ollama."
              : undefined
          }
        />
        <Input
          label="API key"
          containerClassName="sm:col-span-2"
          inputClassName="font-mono"
          name="apiKey"
          type="password"
          autoComplete="off"
          required={style === "anthropic"}
          hint={`Tested with one free call, then encrypted. It is never shown again.${style === "openai-compatible" ? " Leave empty for local servers that need none." : ""}`}
        />
        <Checkbox
          name="free"
          value="on"
          containerClassName="sm:col-span-2"
          label="Free provider (local models): record every reply as $0"
        />
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Private or http addresses, like Ollama on your network, must be added
          to the{" "}
          <Link
            href="/settings"
            className="underline underline-offset-2 hover:text-foreground"
          >
            private host allowlist
          </Link>{" "}
          first.
        </p>
        {error && (
          <p
            role="alert"
            className="text-sm text-primitive-destructive sm:col-span-2"
          >
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" loading={saving}>
            {saving ? "Testing key..." : "Add provider"}
          </Button>
        </div>
      </form>
    </section>
  );
}

type Provider = NonNullable<
  ReturnType<typeof useQuery<typeof api.providers.list>>
>[number];

function ProviderCard({ provider }: { provider: Provider }) {
  const updateModel = useMutation(api.providers.updateModel);
  const remove = useMutation(api.providers.remove);
  const [replacing, setReplacing] = useState(false);
  const visible = provider.models.filter((m) => !m.hidden).length;

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold tracking-[-0.01em]">{provider.name}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {provider.detected} · {provider.baseUrl}
            {provider.free && " · free"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Key checked {new Date(provider.keyCheckedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReplacing(!replacing)}
          >
            Replace key
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hover:text-primitive-destructive"
            onClick={() => {
              if (
                confirm(
                  `Delete ${provider.name}? Its key is removed from this instance.`,
                )
              )
                void remove({ providerId: provider._id });
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      {replacing && (
        <ReplaceKey
          providerId={provider._id}
          onDone={() => setReplacing(false)}
        />
      )}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          Models{" "}
          <span className="font-mono">
            {visible}/{provider.models.length}
          </span>{" "}
          shown
        </summary>
        <ul className="mt-3 flex flex-col">
          {provider.models.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 border-t border-border py-2"
            >
              <Checkbox
                aria-label={`Show ${m.displayName}`}
                checked={!m.hidden}
                fullWidth={false}
                onCheckedChange={(checked) =>
                  void updateModel({
                    providerId: provider._id,
                    modelId: m.id,
                    hidden: checked !== true,
                  })
                }
              />
              <input
                className="min-w-0 flex-1 rounded-[var(--primitive-radius-control-sm)] border border-transparent bg-transparent px-1.5 py-0.5 text-sm transition-colors hover:bg-primitive-surface-hover focus:border-border-strong focus:bg-transparent focus:outline-none"
                aria-label={`Display name for ${m.id}`}
                defaultValue={m.displayName}
                onBlur={(e) => {
                  if (e.target.value !== m.displayName)
                    void updateModel({
                      providerId: provider._id,
                      modelId: m.id,
                      displayName: e.target.value,
                    });
                }}
              />
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {m.id}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ReplaceKey({
  providerId,
  onDone,
}: {
  providerId: Id<"providers">;
  onDone: () => void;
}) {
  const replaceKey = useAction(api.providerActions.replaceKey);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await replaceKey({
            providerId,
            apiKey: String(new FormData(e.currentTarget).get("apiKey")),
          });
          onDone();
        } catch (err) {
          setError(errorText(err));
          setSaving(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          inputClassName="font-mono"
          name="apiKey"
          type="password"
          placeholder="New API key"
          aria-label="New API key"
          autoComplete="off"
          required
          autoFocus
        />
        <Button type="submit" loading={saving}>
          {saving ? "Testing..." : "Save"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-primitive-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
