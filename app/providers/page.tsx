"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconKey,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Checkbox, Input, SegmentedControl, Switch } from "@/components/ui/fields";
import { Dialog } from "@/components/ui/overlay";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const errorText = (err: unknown, fallback = "Something went wrong") =>
  err instanceof ConvexError ? String(err.data) : fallback;

// Provider errors arrive with or without a final period.
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

type Provider = NonNullable<ReturnType<typeof useQuery<typeof api.providers.list>>>[number];

const STYLES = {
  anthropic: { label: "Anthropic", name: "My Anthropic", baseUrl: "https://api.anthropic.com" },
  "openai-compatible": { label: "OpenAI-compatible", name: "My OpenAI", baseUrl: "https://api.openai.com/v1" },
} as const;
type Style = keyof typeof STYLES;

const initials = (name: string) =>
  name
    .split(/[\s·/-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export default function ProvidersPage() {
  const providers = useQuery(api.providers.list);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<Id<"providers"> | null>(null);
  const open = providers?.find((p) => p._id === openId);

  return (
    <ChatShell>
      <div className="tc-page">
        <div className="tc-page-col max-w-[880px]">
          {open ? (
            <ProviderDetail provider={open} onBack={() => setOpenId(null)} />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h1 className="flex-1 text-title">Providers</h1>
                {!adding && providers && providers.length > 0 && (
                  <Button variant="primary" icon={<IconPlus />} onClick={() => setAdding(true)}>
                    Add a provider
                  </Button>
                )}
              </div>
              {(adding || providers?.length === 0) && (
                <AddProvider onDone={() => setAdding(false)} canCancel={!!providers?.length} />
              )}
              {providers && providers.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {providers.map((p) => (
                    <ProviderCard key={p._id} provider={p} onOpen={() => setOpenId(p._id)} />
                  ))}
                </div>
              )}
              {providers?.length === 0 && !adding && (
                <EmptyState
                  title="No providers yet"
                  description="Add one above to start chatting. Keys are encrypted and stay on your server."
                />
              )}
            </>
          )}
        </div>
      </div>
    </ChatShell>
  );
}

/** A configured provider (design system: ProviderCard): initials, name, base URL, status, models. */
function ProviderCard({ provider, onOpen }: { provider: Provider; onOpen: () => void }) {
  const shown = provider.models.filter((m) => !m.hidden);
  return (
    <button type="button" className="tc-card tc-provider holo-ring text-left" onClick={onOpen}>
      <div className="tc-provider-head">
        <span className="tc-provider-logo">{initials(provider.name)}</span>
        <div className="min-w-0 flex-1">
          <div className="tc-provider-name truncate">{provider.name}</div>
          <div className="tc-provider-url truncate">{provider.baseUrl}</div>
        </div>
        <Badge tone="success" icon={<IconCircleCheck size={12} stroke={1.5} />}>
          Key works
        </Badge>
      </div>
      <div className="tc-provider-models">
        {shown.slice(0, 4).map((m) => (
          <Badge key={m.id}>{m.displayName}</Badge>
        ))}
        {shown.length > 4 && <Badge>+{shown.length - 4} more</Badge>}
        {provider.free && <Badge tone="info">free</Badge>}
      </div>
      <p className="tc-mono text-mono-xs text-foreground-subtle">
        {provider.detected} · {shown.length} of {provider.models.length} models shown
      </p>
    </button>
  );
}

// Add a provider (design system: ProviderForm): the key is tested with one free call before it is
// saved; a rejected key says the provider's reason and that nothing was saved.
function AddProvider({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const add = useAction(api.providerActions.add);
  const [style, setStyle] = useState<Style>("anthropic");
  const [free, setFree] = useState(false);
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
        free,
      });
      toast({ title: "Provider added", body: "The key works; its models are ready to pick." });
      formEl.reset();
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not add the provider"));
    }
    setSaving(false);
  }

  return (
    <section className="tc-card tc-pop-in flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-heading">Add a provider</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">
          Use an API key from your provider&apos;s developer console. A ChatGPT Plus or Claude Pro subscription is not an
          API key: API usage is billed separately, from the console.
        </p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <div className="flex flex-col items-start gap-1.5 sm:col-span-2">
          <span className="tc-field-label">API style</span>
          <SegmentedControl
            label="API style"
            value={style}
            onValueChange={setStyle}
            options={Object.entries(STYLES).map(([value, { label }]) => ({ value: value as Style, label }))}
          />
        </div>
        <Input key={`name-${style}`} label="Name" name="name" defaultValue={STYLES[style].name} required />
        <Input
          key={`url-${style}`}
          label="Base URL"
          mono
          name="baseUrl"
          defaultValue={STYLES[style].baseUrl}
          required
          help={style === "openai-compatible" ? "Include the version path, like /v1." : undefined}
        />
        <Input
          label="API key"
          fieldClassName="sm:col-span-2"
          mono
          name="apiKey"
          type="password"
          autoComplete="off"
          required={style === "anthropic"}
          help={`Tested with one free call, then encrypted at rest. It is never shown again.${style === "openai-compatible" ? " Leave empty for local servers that need none." : ""}`}
        />
        <Checkbox
          className="sm:col-span-2"
          checked={free}
          onCheckedChange={setFree}
          label="Free provider (local models): record every reply as $0"
        />
        <p className="text-caption text-foreground-subtle sm:col-span-2">
          Private or http addresses, like Ollama on your network, must be on the{" "}
          <Link href="/settings" className="text-accent underline underline-offset-2">
            private host allowlist
          </Link>{" "}
          first.
        </p>
        {error && (
          <div role="alert" className="tc-fade-in tc-inline-error sm:col-span-2">
            <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
            <span>
              <strong>Could not add the provider.</strong> {sentence(error)} Nothing was saved.
            </span>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? "Testing key…" : "Test and save"}
          </Button>
          {canCancel && (
            <Button variant="ghost" onClick={onDone} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function ProviderDetail({ provider, onBack }: { provider: Provider; onBack: () => void }) {
  const updateModel = useMutation(api.providers.updateModel);
  const remove = useMutation(api.providers.remove);
  const setFree = useMutation(api.providers.setFree);
  const refreshModels = useAction(api.providerActions.refreshModels);
  const [refresh, setRefresh] = useState<"idle" | "busy" | string>("idle");
  const [replacing, setReplacing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const visible = provider.models.filter((m) => !m.hidden).length;
  const openai = provider.apiStyle === "openai-compatible";

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBack}>
          Providers
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title">{provider.name}</h1>
        <Badge tone="success" dot>
          Key works
        </Badge>
        {provider.free && <Badge tone="info">free</Badge>}
        <span className="flex-1" />
        <Button variant="ghost" icon={<IconTrash />} onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>
      <div className="tc-card grid gap-5 p-5 md:grid-cols-3 md:items-end">
        <div className="flex flex-col gap-1">
          <p className="text-overline text-foreground-muted uppercase">API style</p>
          <p className="text-body">{STYLES[provider.apiStyle as Style]?.label ?? provider.apiStyle}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-overline text-foreground-muted uppercase">Base URL</p>
          <p className="tc-mono truncate text-mono" title={provider.baseUrl}>
            {provider.baseUrl}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex flex-1 flex-col gap-1">
            <p className="text-overline text-foreground-muted uppercase">API key</p>
            <p className="tc-mono text-mono" title={`Checked ${new Date(provider.keyCheckedAt).toLocaleString()}`}>
              encrypted
            </p>
          </div>
          <Button variant="outline" size="sm" icon={<IconKey />} onClick={() => setReplacing(!replacing)}>
            Replace key
          </Button>
        </div>
        {replacing && (
          <ReplaceKey providerId={provider._id} onDone={() => setReplacing(false)} />
        )}
      </div>

      <div className="tc-card flex flex-col gap-1.5 p-5">
        <Switch
          checked={provider.free}
          onCheckedChange={(free) =>
            void setFree({ providerId: provider._id, free }).then(() =>
              toast({ title: free ? "Calls are now recorded as $0" : "Calls are priced again" }),
            )
          }
          label="Free provider: record every call through it as $0"
        />
        <p className="pl-[38px] text-body-sm text-foreground-muted">
          For local models you don&apos;t pay for. Leave it off for anything that bills you, including a proxy in front
          of a paid API. Changes apply to calls from now on.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="flex-1 text-heading">Models</h2>
        <span className="tc-mono text-mono-sm text-foreground-muted">
          {provider.models.length} models · {visible} shown
        </span>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefresh />}
          loading={refresh === "busy"}
          title="Fetch the model list again: new models and which accept images"
          onClick={() => {
            setRefresh("busy");
            refreshModels({ providerId: provider._id })
              .then(() => setRefresh("idle"))
              .catch((err) => setRefresh(errorText(err, "The provider did not answer")));
          }}
        >
          Refresh models
        </Button>
      </div>
      {refresh !== "idle" && refresh !== "busy" && (
        <div role="alert" className="tc-fade-in tc-inline-error">
          <IconAlertTriangle size={16} stroke={1.5} className="mt-0.5 shrink-0" />
          <span>
            <strong>Could not refresh the models.</strong> {sentence(refresh)} Your list is unchanged.
          </span>
        </div>
      )}
      <div className="tc-models">
        <div className="tc-models-row tc-models-head">
          <span>Display name</span>
          <span>Model id</span>
          <span>Images</span>
          <span>Shown</span>
        </div>
        {provider.models.map((m) => (
          <div key={m.id} className="tc-models-row">
            <label className="tc-rename">
              <input
                aria-label={`Display name for ${m.id}`}
                defaultValue={m.displayName}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== m.displayName)
                    void updateModel({ providerId: provider._id, modelId: m.id, displayName: e.target.value });
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
              <IconPencil size={13} stroke={1.5} aria-hidden />
            </label>
            <span className="tc-mono truncate text-mono-sm text-foreground-muted" title={m.id}>
              {m.id}
            </span>
            {openai ? (
              <Switch
                aria-label={`${m.displayName} accepts images`}
                checked={m.vision === true}
                onCheckedChange={(v) => void updateModel({ providerId: provider._id, modelId: m.id, vision: v })}
              />
            ) : (
              <span className="text-body-sm text-foreground-muted" title="From the provider">
                {m.vision ? "Yes" : "No"}
              </span>
            )}
            <Switch
              aria-label={`Show ${m.displayName}`}
              checked={!m.hidden}
              onCheckedChange={(v) => void updateModel({ providerId: provider._id, modelId: m.id, hidden: !v })}
            />
          </div>
        ))}
      </div>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        tone="danger"
        icon={<IconTrash size={18} stroke={1.5} />}
        title={`Delete ${provider.name}?`}
        description="Its key is removed from this instance. Threads on it keep their history."
        actions={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleting(false);
                onBack();
                void remove({ providerId: provider._id });
              }}
            >
              Delete provider
            </Button>
          </>
        }
      />
    </>
  );
}

function ReplaceKey({ providerId, onDone }: { providerId: Id<"providers">; onDone: () => void }) {
  const replaceKey = useAction(api.providerActions.replaceKey);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className={cn("tc-fade-in flex flex-col gap-2 md:col-span-3")}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await replaceKey({ providerId, apiKey: String(new FormData(e.currentTarget).get("apiKey")) });
          toast({ title: "Key replaced" });
          onDone();
        } catch (err) {
          setError(errorText(err, "Could not replace the key"));
          setSaving(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          mono
          name="apiKey"
          type="password"
          placeholder="New API key"
          aria-label="New API key"
          autoComplete="off"
          required
          autoFocus
          error={error ? `${sentence(error)} The old key is still in use.` : undefined}
          fieldClassName="flex-1"
        />
        <Button type="submit" variant="primary" loading={saving} className="self-start">
          {saving ? "Testing key…" : "Test and save"}
        </Button>
      </div>
    </form>
  );
}
