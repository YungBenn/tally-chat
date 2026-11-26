"use client";

import {
  IconAdjustmentsHorizontal,
  IconArrowUpRight,
  IconCoin,
  IconCpu,
  IconSearch,
  IconShieldLock,
  IconStack2,
  IconWorldSearch,
  IconX,
} from "@tabler/icons-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Fragment, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select, Switch, Textarea } from "@/components/ui/fields";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  type Effort,
} from "@/convex/lib/effort";

const errorText = (err: unknown) =>
  err instanceof ConvexError ? String(err.data) : "Could not save";

/**
 * One setting (design system: SettingsSection): title and explanation on the left, the control on
 * the right. `stacked` puts a wide control (a textarea, a list) under the text instead.
 */
function SettingsRow({
  title,
  children,
  control,
  stacked,
}: {
  title: string;
  children?: React.ReactNode;
  control: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className="tc-srow" data-stacked={stacked || undefined}>
      <div className="min-w-0">
        <h4 className="text-body font-medium">{title}</h4>
        {children && (
          <p className="mt-0.5 text-body-sm text-foreground-muted">
            {children}
          </p>
        )}
      </div>
      <div className="tc-srow-control">{control}</div>
    </div>
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

/** A switch on the right of its row, with its save error under it. */
function SwitchSetting({
  checked,
  label,
  onSave,
}: {
  checked: boolean;
  label: string;
  onSave: (on: boolean) => Promise<unknown>;
}) {
  const [error, run] = useSave();
  return (
    <>
      <Switch
        checked={checked}
        aria-label={label}
        onCheckedChange={(on) => run(onSave(on))}
      />
      {error && <p className="tc-field-error tc-fade-in">{error}</p>}
    </>
  );
}

function CustomInstructions() {
  const settings = useQuery(api.settings.get);
  const setInstructions = useMutation(api.settings.setCustomInstructions);
  const [error, run] = useSave();
  if (!settings) return null;
  return (
    <SettingsRow
      title="Custom instructions"
      stacked
      control={
        <Textarea
          key={settings.customInstructions}
          aria-label="Custom instructions"
          rows={6}
          maxLength={4000}
          placeholder="I write TypeScript. Answer in British English."
          defaultValue={settings.customInstructions}
          error={error ?? undefined}
          onBlur={(e) => {
            if (e.target.value.trim() !== settings.customInstructions)
              run(setInstructions({ instructions: e.target.value }));
          }}
        />
      }
    >
      What every new thread should know about you and how to answer. Threads
      you already started keep the instructions they began with, so their
      cache stays warm.
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

function DefaultModel() {
  const settings = useQuery(api.settings.get);
  const providers = useQuery(api.providers.list);
  const setDefaultModel = useMutation(api.settings.setDefaultModel);
  const [error, run] = useSave();
  if (!settings || !providers) return null;
  const current = settings.defaultModel
    ? `${settings.defaultModel.providerId}|${settings.defaultModel.modelId}`
    : "first";
  return (
    <SettingsRow
      title="Default model"
      control={
        <Select
          aria-label="Default model"
          value={current}
          error={error ?? undefined}
          onValueChange={(v) => {
            const [providerId, modelId] = v.split("|");
            run(
              setDefaultModel({
                defaultModel:
                  v === "first"
                    ? null
                    : { providerId: providerId as Id<"providers">, modelId },
              }),
            );
          }}
          options={[
            { value: "first", label: "First listed model" },
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
      The model a new thread starts on. You can still pick another one before
      sending.
    </SettingsRow>
  );
}

function DefaultEffort() {
  const settings = useQuery(api.settings.get);
  const setDefaultEffort = useMutation(api.settings.setDefaultEffort);
  const [error, run] = useSave();
  if (!settings) return null;
  return (
    <SettingsRow
      title="Default effort"
      control={
        <Select
          aria-label="Default effort"
          value={settings.defaultEffort ?? DEFAULT_EFFORT}
          error={error ?? undefined}
          onValueChange={(v) =>
            run(setDefaultEffort({ effort: v as Effort }))
          }
          options={EFFORT_LEVELS.map((e) => ({ value: e, label: e }))}
        />
      }
    >
      How hard a new thread&apos;s model thinks, on models that support effort.
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

function Keepalive() {
  const settings = useQuery(api.settings.get);
  const setKeepaliveEnabled = useMutation(api.settings.setKeepaliveEnabled);
  if (!settings) return null;
  return (
    <SettingsRow
      title="Cache keepalive"
      control={
        <SwitchSetting
          checked={settings.keepaliveEnabled}
          label="Keep caches warm while I'm in a thread"
          onSave={(enabled) => setKeepaliveEnabled({ enabled })}
        />
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
  if (!settings) return null;
  const { enabled, atTokens, keepTurns } = settings.condense;
  return (
    <>
      <SettingsRow
        title="Condense long threads"
        control={
          <SwitchSetting
            checked={enabled}
            label="Condense long threads automatically"
            onSave={(on) => setCondense({ enabled: on })}
          />
        }
      >
        When recent turns grow past the threshold, older turns fold into a
        summary by the thread&apos;s own model. A condense that wouldn&apos;t pay for
        itself through the cache waits.
      </SettingsRow>
      <SettingsRow
        title="Condense past"
        control={
          <NumberSetting
            value={atTokens}
            label="Condense past, in tokens of recent turns"
            step={1000}
            min={5000}
            max={500000}
            onSave={(v) => setCondense({ atTokens: v! })}
          />
        }
      >
        Tokens of recent turns before older ones are condensed. Default 80,000.
      </SettingsRow>
      <SettingsRow
        title="Keep last"
        control={
          <NumberSetting
            value={keepTurns}
            label="Turns kept word for word"
            step={1}
            min={1}
            max={50}
            onSave={(v) => setCondense({ keepTurns: v! })}
          />
        }
      >
        Turns that always stay word for word.
      </SettingsRow>
    </>
  );
}

function WebSearch() {
  const settings = useQuery(api.settings.get);
  const setSearchKey = useAction(api.settings.setSearchKey);
  const [error, run] = useSave();
  const field = useRef<HTMLInputElement>(null);
  if (!settings) return null;
  // The key never comes back, so the field stays empty: typed text saves, empty text does nothing.
  // It empties before the save, so Enter then blur saves once; a failed save puts the text back.
  const commit = (input: HTMLInputElement) => {
    const apiKey = input.value;
    if (!apiKey.trim()) return;
    input.value = "";
    run(
      setSearchKey({ apiKey }).catch((err: unknown) => {
        if (!input.value) input.value = apiKey;
        throw err;
      }),
    );
  };
  return (
    <SettingsRow
      title="Exa API key"
      control={
        <div className="flex items-start gap-2">
          <Input
            ref={field}
            aria-label="Exa API key"
            mono
            type="password"
            autoComplete="off"
            placeholder={
              settings.searchKeySet
                ? "Key saved - paste a new one to replace"
                : "Paste your Exa API key"
            }
            error={error ?? undefined}
            fieldClassName="flex-1"
            onBlur={(e) => commit(e.target)}
            onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget)}
          />
          {settings.searchKeySet && (
            <Button
              variant="ghost"
              // Keeps focus in the field, so its blur can't save the typed text first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (field.current) field.current.value = "";
                run(setSearchKey({ apiKey: "" }), "Key removed");
              }}
            >
              Remove
            </Button>
          )}
        </div>
      }
    >
      With a key saved, the composer gets a Search toggle: the message is
      searched on Exa before the reply, and the results are sent with it. Get a
      key from{" "}
      <a
        className="text-accent underline underline-offset-2"
        href="https://dashboard.exa.ai/api-keys"
        target="_blank"
        rel="noopener noreferrer"
      >
        Exa&apos;s dashboard
      </a>
      . Each search costs about a cent and counts toward spend.
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
      stacked
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

/**
 * The sections in the settings nav. `terms` names what each section holds, for search: a section
 * matches when every query word is found in its label or terms. `group` breaks the nav with a
 * divider when it changes.
 */
const SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: IconAdjustmentsHorizontal,
    group: 0,
    terms: "custom instructions system prompt about me time zone timezone day",
    Content: () => (
      <>
        <CustomInstructions />
        <TimeZone />
      </>
    ),
  },
  {
    id: "models",
    label: "Models",
    icon: IconCpu,
    group: 0,
    terms: "default model effort new thread side-job model titles cheap",
    Content: () => (
      <>
        <DefaultModel />
        <DefaultEffort />
        <SideJobModel />
      </>
    ),
  },
  {
    id: "spending",
    label: "Spending",
    icon: IconCoin,
    group: 0,
    terms: "daily budget limit cost money cache-break confirmation edit",
    Content: () => (
      <>
        <DailyBudget />
        <CacheBreakConfirm />
      </>
    ),
  },
  {
    id: "context",
    label: "Context & cache",
    icon: IconStack2,
    group: 1,
    terms: "cache keepalive warm condense condensing summary tokens turns",
    Content: () => (
      <>
        <Keepalive />
        <Condensing />
      </>
    ),
  },
  {
    id: "search",
    label: "Web search",
    icon: IconWorldSearch,
    group: 1,
    terms: "exa api key internet",
    Content: WebSearch,
  },
  {
    id: "network",
    label: "Network",
    icon: IconShieldLock,
    group: 1,
    terms: "private host allowlist ollama lan http",
    Content: Allowlist,
  },
];

// Settings open over whatever page you're on: the URL hash `#settings` opens them and
// `#settings/<section>` picks the section, so links, reloads and the back button all work.
const onHashChange = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

/** Close by dropping the hash without adding a history entry. */
function closeSettings() {
  history.replaceState(null, "", location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export default function SettingsDialog() {
  const hash = useSyncExternalStore(
    onHashChange,
    () => window.location.hash,
    () => "",
  );
  const open = hash === "#settings" || hash.startsWith("#settings/");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = SECTIONS.filter((s) => {
    const text = `${s.label} ${s.terms}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const active =
    SECTIONS.find((s) => hash === `#settings/${s.id}`) ?? SECTIONS[0];
  // While searching, every matching section shows; otherwise the open one.
  const visible = words.length ? shown : [active];

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSettings();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setSearch("");
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="tc-scrim" />
        <BaseDialog.Popup
          className="tc-dialog-modal tc-settings-modal"
          // Start in the search, except on touch screens, where that would pop up the keyboard.
          initialFocus={() =>
            matchMedia("(pointer: coarse)").matches || searchRef.current
          }
        >
          <header className="tc-settings-head">
            <BaseDialog.Title render={<h2 className="text-heading" />}>
              Settings
            </BaseDialog.Title>
            <BaseDialog.Close
              className="tc-btn tc-btn-ghost tc-btn-icon"
              aria-label="Close settings"
            >
              <IconX size={18} stroke={1.5} />
            </BaseDialog.Close>
          </header>
          <div className="tc-settings-page">
            <aside className="tc-settings-nav">
              <label className="tc-input tc-search">
                <IconSearch
                  size={16}
                  stroke={1.5}
                  className="shrink-0 text-foreground-subtle"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    // Esc clears the search first; with nothing typed it closes the dialog.
                    if (e.key === "Escape" && search) {
                      e.stopPropagation();
                      setSearch("");
                    }
                  }}
                  placeholder="Search"
                  aria-label="Search settings"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="tc-search-clear"
                    onClick={() => setSearch("")}
                  >
                    <IconX size={14} stroke={1.5} />
                  </button>
                )}
              </label>
              <nav aria-label="Settings sections" className="tc-settings-links">
                {shown.map(({ id, label, icon: Icon, group }, i) => (
                  <Fragment key={id}>
                    {i > 0 && group !== shown[i - 1].group && (
                      <hr className="tc-settings-sep" />
                    )}
                    <a
                      href={`#settings/${id}`}
                      onClick={(e) => {
                        // Switching sections replaces the entry, so Back closes the dialog.
                        e.preventDefault();
                        setSearch("");
                        history.replaceState(null, "", `#settings/${id}`);
                        window.dispatchEvent(new HashChangeEvent("hashchange"));
                      }}
                      aria-current={
                        !words.length && id === active.id ? "page" : undefined
                      }
                      className="tc-nav"
                      // On phones the links scroll sideways; keep the open one in view.
                      ref={(el) => {
                        if (el?.getAttribute("aria-current"))
                          el.scrollIntoView({ block: "nearest", inline: "nearest" });
                      }}
                    >
                      <Icon size={16} stroke={1.5} />
                      {label}
                    </a>
                  </Fragment>
                ))}
                {shown.length === 0 && (
                  <p className="tc-sidebar-note px-2.5!">Nothing matches.</p>
                )}
                <Link href="/import" className="tc-nav tc-settings-foot">
                  Import history
                  <IconArrowUpRight size={16} stroke={1.5} className="ml-auto" />
                </Link>
              </nav>
            </aside>
            <div
              key={visible.map((s) => s.id).join()}
              className="tc-settings-main"
            >
              <div className="tc-settings-col">
                {visible.map(({ id, label, Content }) => (
                  <section key={id} aria-labelledby={`settings-${id}`}>
                    <h3 id={`settings-${id}`} className="mb-2 text-heading">
                      {label}
                    </h3>
                    <Content />
                  </section>
                ))}
              </div>
            </div>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
