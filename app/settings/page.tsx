"use client";

import { IconFileImport, IconX } from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select, Switch } from "@/components/ui/fields";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const errorText = (err: unknown) =>
  err instanceof ConvexError ? String(err.data) : "Could not save";

/** Title and one or two sentences on the left, the control on the right (design system: SettingsSection). */
function SettingsRow({
  title,
  children,
  control,
}: {
  title: string;
  children: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <section className="tc-settings-row-x">
      <div>
        <h2 className="text-subheading">{title}</h2>
        <p className="mt-1 text-body-sm text-foreground-muted">{children}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{control}</div>
    </section>
  );
}

/** Run a save; toast on success, keep the error inline (the value stays as it was). */
function useSave() {
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>, done = "Saved") => {
    setError(null);
    p.then(() => toast({ title: done })).catch((err) =>
      setError(errorText(err)),
    );
  };
  return [error, run] as const;
}

/**
 * A number field that saves on blur or ↵ when its value changed. `toValue` turns the text into
 * what is saved (null clears it); invalid text is reported, not saved.
 */
function NumberSetting({
  value,
  label,
  prefix,
  placeholder,
  step,
  min,
  max,
  scale = 1,
  allowEmpty,
  onSave,
}: {
  value: number | null;
  label: string;
  prefix?: string;
  placeholder?: string;
  step: number;
  min: number;
  max?: number;
  scale?: number; // the field shows value / scale (dollars for micro-dollars)
  allowEmpty?: boolean;
  onSave: (v: number | null) => Promise<unknown>;
}) {
  const [error, run] = useSave();
  const shown = value === null ? "" : String(value / scale);
  const commit = (text: string) => {
    const raw = text.trim();
    if (raw === shown) return;
    if (raw === "" && allowEmpty) return run(onSave(null));
    const n = Number(raw);
    if (
      raw === "" ||
      !Number.isFinite(n) ||
      n < min ||
      (max !== undefined && n > max)
    )
      return run(
        Promise.reject(
          new ConvexError(
            `Enter a number from ${min}${max !== undefined ? ` to ${max}` : " up"}`,
          ),
        ),
      );
    run(onSave(Math.round(n * scale)));
  };
  return (
    <div className="tc-number-field">
      {prefix && <span className="tc-number-prefix">{prefix}</span>}
      <Input
        key={shown}
        aria-label={label}
        type="number"
        mono
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        defaultValue={shown}
        error={error ?? undefined}
        style={prefix ? { paddingLeft: 24 } : undefined}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
      />
    </div>
  );
}

function SideJobModel() {
  const settings = useQuery(api.settings.get);
  const providers = useQuery(api.providers.list);
  const setSideJobModel = useMutation(api.settings.setSideJobModel);
  const [error, run] = useSave();
  if (!settings || !providers) return null;
  const current = settings.sideJobModel
    ? `${settings.sideJobModel.providerId}|${settings.sideJobModel.modelId}`
    : "default";
  return (
    <SettingsRow
      title="Side-job model"
      control={
        <Select
          aria-label="Side-job model"
          value={current}
          error={error ?? undefined}
          onValueChange={(v) => {
            const [providerId, modelId] = v.split("|");
            run(
              setSideJobModel({
                sideJobModel:
                  v === "default"
                    ? null
                    : { providerId: providerId as Id<"providers">, modelId },
              }),
            );
          }}
          options={[
            { value: "default", label: "Cheapest of each thread's provider" },
            ...providers.flatMap((p) =>
              p.models
                .filter((m) => !m.hidden)
                .map((m) => ({
                  value: `${p._id}|${m.id}`,
                  label: m.displayName,
                  group: p.name,
                })),
            ),
          ]}
        />
      }
    >
      Runs work you didn&apos;t ask for directly, like thread titles and
      condensing. Pick something cheap: it is metered like any other call.
    </SettingsRow>
  );
}

function Keepalive() {
  const settings = useQuery(api.settings.get);
  const setKeepaliveEnabled = useMutation(api.settings.setKeepaliveEnabled);
  const [error, run] = useSave();
  if (!settings) return null;
  return (
    <SettingsRow
      title="Cache keepalive"
      control={
        <>
          <Switch
            checked={settings.keepaliveEnabled}
            onCheckedChange={(enabled) => run(setKeepaliveEnabled({ enabled }))}
            label="Keep caches warm while I'm in a thread"
          />
          {error && <p className="tc-field-error tc-fade-in">{error}</p>}
        </>
      }
    >
      While you&apos;re in a thread, tally.chat refreshes its 5-minute cache
      just before it expires, so pausing to read doesn&apos;t make your next
      message expensive. Each refresh is a small metered side job, and they stop
      30 minutes after you leave. Off, threads use the 1-hour cache instead.
    </SettingsRow>
  );
}

function Condensing() {
  const settings = useQuery(api.settings.get);
  const setCondense = useMutation(api.settings.setCondense);
  const [error, run] = useSave();
  if (!settings) return null;
  const { enabled, atTokens, keepTurns } = settings.condense;
  return (
    <SettingsRow
      title="Condensing"
      control={
        <>
          <Switch
            checked={enabled}
            onCheckedChange={(on) => run(setCondense({ enabled: on }))}
            label="Condense long threads automatically"
          />
          {error && <p className="tc-field-error tc-fade-in">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-foreground-muted">
                Past (tokens)
              </span>
              <NumberSetting
                value={atTokens}
                label="Condense past, in tokens of recent turns"
                step={1000}
                min={5000}
                max={500000}
                onSave={(v) => setCondense({ atTokens: v! })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-foreground-muted">
                Keep last (turns)
              </span>
              <NumberSetting
                value={keepTurns}
                label="Turns kept word for word"
                step={1}
                min={1}
                max={50}
                onSave={(v) => setCondense({ keepTurns: v! })}
              />
            </label>
          </div>
        </>
      }
    >
      When recent turns grow past the threshold, older turns fold into a summary
      by your side-job model; the last few stay word for word, and a condense
      that wouldn&apos;t pay for itself through the cache waits.
    </SettingsRow>
  );
}

function CacheBreakConfirm() {
  const settings = useQuery(api.settings.get);
  const setThreshold = useMutation(api.settings.setCacheBreakConfirm);
  if (!settings) return null;
  return (
    <SettingsRow
      title="Cache-break confirmation"
      control={
        <NumberSetting
          value={settings.cacheBreakConfirmMicroUsd}
          label="Confirm above, in US dollars"
          prefix="$"
          step={0.01}
          min={0}
          scale={1e6}
          onSave={(microUsd) => setThreshold({ microUsd: microUsd! })}
        />
      }
    >
      Editing a past message throws away the cached history after it. When that
      costs more than this, tally.chat asks first.
    </SettingsRow>
  );
}

function DailyBudget() {
  const settings = useQuery(api.settings.get);
  const setBudget = useMutation(api.settings.setDailyBudget);
  if (!settings) return null;
  return (
    <SettingsRow
      title="Daily budget"
      control={
        <NumberSetting
          value={settings.dailyBudgetMicroUsd}
          label="Daily budget, in US dollars"
          prefix="$"
          placeholder="No budget"
          step={0.01}
          min={0}
          scale={1e6}
          allowEmpty
          onSave={(microUsd) => setBudget({ microUsd })}
        />
      }
    >
      A soft daily limit in your time zone: a warning at 80%, and at 100%
      sending pauses until tomorrow unless you override it. Leave empty for no
      budget. Calls without a price don&apos;t count.
    </SettingsRow>
  );
}

function TimeZone() {
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);
  const [error, run] = useSave();
  if (!settings) return null;
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <SettingsRow
      title="Time zone"
      control={
        <Select
          aria-label="Time zone"
          value={settings.timeZone ?? "UTC"}
          error={error ?? undefined}
          onValueChange={(timeZone) => run(setTimeZone({ timeZone }))}
          options={(zones.includes("UTC") ? zones : ["UTC", ...zones]).map(
            (zone) => ({
              value: zone,
              label: zone.replaceAll("_", " "),
            }),
          )}
        />
      }
    >
      Where your day starts and ends for daily spend. Changes apply to new
      calls; past days keep their dates.
    </SettingsRow>
  );
}

function Allowlist() {
  const settings = useQuery(api.settings.get);
  const addHost = useMutation(api.settings.addAllowedHost);
  const removeHost = useMutation(api.settings.removeAllowedHost);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  return (
    <SettingsRow
      title="Private host allowlist"
      control={
        <>
          {settings.allowlistedHosts.length > 0 && (
            <ul className="tc-hosts">
              {settings.allowlistedHosts.map((host) => (
                <li key={host}>
                  <span className="tc-mono truncate text-mono-sm">{host}</span>
                  <IconButton
                    icon={<IconX />}
                    label={`Remove ${host}`}
                    size="sm"
                    onClick={() => void removeHost({ host })}
                  />
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const formEl = e.currentTarget;
              setError(null);
              try {
                await addHost({
                  host: String(new FormData(formEl).get("host")),
                });
                formEl.reset();
                toast({ title: "Host added" });
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <Input
              mono
              name="host"
              placeholder="192.168.1.20:11434"
              aria-label="Host"
              required
              error={error ?? undefined}
              help={
                error
                  ? undefined
                  : "A host, or host:port to allow only that port."
              }
              fieldClassName="flex-1"
            />
            <Button type="submit" className="self-start">
              Add
            </Button>
          </form>
        </>
      }
    >
      This server only calls public https addresses unless a host is listed
      here, over http too. Add only machines you trust, such as Ollama on your
      LAN.
    </SettingsRow>
  );
}

export default function SettingsPage() {
  return (
    <ChatShell>
      <div className="tc-page">
        <div className="tc-page-col max-w-[800px] gap-2!">
          <h1 className="mb-4 text-title">Settings</h1>
          <SideJobModel />
          <Keepalive />
          <Condensing />
          <CacheBreakConfirm />
          <DailyBudget />
          <TimeZone />
          <Allowlist />
          <SettingsRow
            title="Import"
            control={
              <div>
                <Link href="/import" className="tc-btn tc-btn-secondary">
                  <IconFileImport size={16} stroke={1.5} />
                  Import history
                </Link>
              </div>
            }
          >
            Bring your conversations from a ChatGPT or Claude data export.
          </SettingsRow>
        </div>
      </div>
    </ChatShell>
  );
}
