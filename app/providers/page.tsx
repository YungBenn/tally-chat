"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const input =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const primary =
  "cursor-pointer rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const quiet = "cursor-pointer rounded-lg px-2.5 py-1 text-sm text-muted hover:bg-line/60 hover:text-foreground";

const errorText = (err: unknown) => (err instanceof ConvexError ? String(err.data) : "Something went wrong");

export default function ProvidersPage() {
  const providers = useQuery(api.providers.list);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <h1 className="font-serif text-2xl">Providers</h1>
        {providers?.map((p) => <ProviderCard key={p._id} provider={p} />)}
        {providers?.length === 0 && <p className="text-sm text-muted">No providers yet. Add one to start chatting.</p>}
        <AddProvider />
      </main>
    </div>
  );
}

function AddProvider() {
  const add = useAction(api.providers.add);
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
        apiStyle: "anthropic",
        baseUrl: String(form.get("baseUrl")),
        apiKey: String(form.get("apiKey")),
      });
      formEl.reset();
    } catch (err) {
      setError(errorText(err));
    }
    setSaving(false);
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
      <div>
        <h2 className="font-medium">Add a provider</h2>
        <p className="mt-1 text-sm text-muted">
          Use an API key from your provider&apos;s developer console. A ChatGPT Plus or Claude Pro subscription is not an
          API key: API usage is billed separately, from the console.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Name
          <input className={input} name="name" defaultValue="My Anthropic" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          API style
          <select className={input} name="apiStyle" defaultValue="anthropic">
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          Base URL
          <input className={`${input} font-mono`} name="baseUrl" defaultValue="https://api.anthropic.com" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
          API key
          <input className={`${input} font-mono`} name="apiKey" type="password" autoComplete="off" required />
          <span className="text-xs font-normal text-muted">
            Tested with one free call, then encrypted. It is never shown again.
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <button className={primary} disabled={saving}>
            {saving ? "Testing key..." : "Add provider"}
          </button>
        </div>
      </form>
    </section>
  );
}

type Provider = NonNullable<ReturnType<typeof useQuery<typeof api.providers.list>>>[number];

function ProviderCard({ provider }: { provider: Provider }) {
  const updateModel = useMutation(api.providers.updateModel);
  const remove = useMutation(api.providers.remove);
  const [replacing, setReplacing] = useState(false);
  const visible = provider.models.filter((m) => !m.hidden).length;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-medium">{provider.name}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">
            {provider.detected} · {provider.baseUrl}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Key checked {new Date(provider.keyCheckedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-1">
          <button className={quiet} onClick={() => setReplacing(!replacing)}>
            Replace key
          </button>
          <button
            className={`${quiet} hover:text-danger`}
            onClick={() => {
              if (confirm(`Delete ${provider.name}? Its key is removed from this instance.`))
                void remove({ providerId: provider._id });
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {replacing && <ReplaceKey providerId={provider._id} onDone={() => setReplacing(false)} />}
      <details>
        <summary className="cursor-pointer text-sm text-muted">
          Models <span className="font-mono">{visible}/{provider.models.length}</span> shown
        </summary>
        <ul className="mt-3 flex flex-col">
          {provider.models.map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-t border-line py-2">
              <input
                type="checkbox"
                aria-label={`Show ${m.displayName}`}
                checked={!m.hidden}
                onChange={(e) => void updateModel({ providerId: provider._id, modelId: m.id, hidden: !e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              <input
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm hover:border-line focus:border-accent focus:outline-none"
                aria-label={`Display name for ${m.id}`}
                defaultValue={m.displayName}
                onBlur={(e) => {
                  if (e.target.value !== m.displayName)
                    void updateModel({ providerId: provider._id, modelId: m.id, displayName: e.target.value });
                }}
              />
              <span className="hidden font-mono text-xs text-muted sm:inline">{m.id}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ReplaceKey({ providerId, onDone }: { providerId: Id<"providers">; onDone: () => void }) {
  const replaceKey = useAction(api.providers.replaceKey);
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
          await replaceKey({ providerId, apiKey: String(new FormData(e.currentTarget).get("apiKey")) });
          onDone();
        } catch (err) {
          setError(errorText(err));
          setSaving(false);
        }
      }}
    >
      <div className="flex gap-2">
        <input className={`${input} font-mono`} name="apiKey" type="password" placeholder="New API key" autoComplete="off" required autoFocus />
        <button className={primary} disabled={saving}>
          {saving ? "Testing..." : "Save"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
