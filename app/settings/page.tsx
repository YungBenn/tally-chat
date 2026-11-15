"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import { Button } from "@/components/wensity/button";
import { Checkbox } from "@/components/wensity/checkbox";
import { Input } from "@/components/wensity/input";
import { NativeSelect } from "@/components/wensity/native-select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function SideJobModel() {
  const settings = useQuery(api.settings.get);
  const providers = useQuery(api.providers.list);
  const setSideJobModel = useMutation(api.settings.setSideJobModel);
  if (!settings || !providers) return null;
  const current = settings.sideJobModel
    ? `${settings.sideJobModel.providerId}|${settings.sideJobModel.modelId}`
    : "";

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Side-job model</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs work you didn&apos;t ask for directly, like thread titles and
          condensing. Pick something cheap: it is metered like any other call.
        </p>
      </div>
      <NativeSelect
        aria-label="Side-job model"
        value={current}
        onChange={(e) => {
          const [providerId, modelId] = e.target.value.split("|");
          void setSideJobModel({
            sideJobModel: e.target.value
              ? { providerId: providerId as Id<"providers">, modelId }
              : null,
          });
        }}
      >
        <option value="">
          Default: the cheapest priced model of each thread&apos;s provider
        </option>
        {providers.flatMap((p) =>
          p.models
            .filter((m) => !m.hidden)
            .map((m) => (
              <option key={`${p._id}|${m.id}`} value={`${p._id}|${m.id}`}>
                {p.name} · {m.displayName}
              </option>
            )),
        )}
      </NativeSelect>
    </section>
  );
}

function Keepalive() {
  const settings = useQuery(api.settings.get);
  const setKeepaliveEnabled = useMutation(api.settings.setKeepaliveEnabled);
  if (!settings) return null;

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Cache keepalive</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Anthropic caches a thread for 5 minutes. While you&apos;re in a
          thread, tally.chat refreshes it shortly before it expires, so pausing
          to read doesn&apos;t make your next message expensive. Each refresh is
          a small metered side job, and they stop 30 minutes after you leave.
          Turned off, threads use the 1-hour cache instead (from their second
          message), which costs more to write but needs no refreshes.
        </p>
      </div>
      <Checkbox
        checked={settings.keepaliveEnabled}
        onCheckedChange={(enabled) => void setKeepaliveEnabled({ enabled })}
        label="Keep caches warm while I'm in a thread"
      />
    </section>
  );
}

function Condensing() {
  const settings = useQuery(api.settings.get);
  const setCondense = useMutation(api.settings.setCondense);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!settings) return null;
  const { enabled, atTokens, keepTurns } = settings.condense;
  const save = (fields: {
    enabled?: boolean;
    atTokens?: number;
    keepTurns?: number;
  }) => {
    setError(null);
    setSaved(false);
    setCondense(fields)
      .then(() => setSaved(true))
      .catch((err) =>
        setError(
          err instanceof ConvexError ? String(err.data) : "Could not save",
        ),
      );
  };

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Condensing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When a thread&apos;s recent turns grow past the threshold, older turns
          are folded into a summary by your side-job model, so each message
          resends less. The most recent turns always stay word for word, and a
          condense that wouldn&apos;t pay for itself through the prompt cache
          waits. You can still condense a thread by hand from its inspector.
        </p>
      </div>
      <Checkbox
        checked={enabled}
        onCheckedChange={(on) => save({ enabled: on })}
        label="Condense long threads automatically"
      />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          save({
            atTokens: Number(form.get("atTokens")),
            keepTurns: Number(form.get("keepTurns")),
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Condense past (tokens)
          <Input
            key={`at-${atTokens}`}
            name="atTokens"
            type="number"
            min={5000}
            max={500000}
            step={1000}
            defaultValue={atTokens}
            aria-label="Condense past, in tokens of recent turns"
            containerClassName="w-40"
            inputClassName="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Keep the last (turns)
          <Input
            key={`keep-${keepTurns}`}
            name="keepTurns"
            type="number"
            min={1}
            max={50}
            step={1}
            defaultValue={keepTurns}
            aria-label="Turns kept word for word"
            containerClassName="w-40"
            inputClassName="font-mono"
          />
        </label>
        <Button type="submit" variant="outline">
          Save
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-primitive-destructive">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-muted-foreground">
          Saved. It applies from the next reply.
        </p>
      )}
    </section>
  );
}

function DailyBudget() {
  const settings = useQuery(api.settings.get);
  const setBudget = useMutation(api.settings.setDailyBudget);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  const save = (microUsd: number | null) => {
    setError(null);
    setBudget({ microUsd }).catch((err) =>
      setError(
        err instanceof ConvexError ? String(err.data) : "Could not save",
      ),
    );
  };

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Daily budget</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A soft limit on what you spend in a day, in your time zone. You get a
          warning at 80%. At 100% sending pauses until tomorrow unless you
          override it for the day, and keepalives and side jobs pause on their
          own. Calls without a price don&apos;t count.
        </p>
      </div>
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const raw = String(
            new FormData(e.currentTarget).get("budget"),
          ).trim();
          save(raw === "" ? null : Math.round(Number(raw) * 1e6));
        }}
      >
        <Input
          key={settings.dailyBudgetMicroUsd ?? "none"}
          name="budget"
          type="number"
          min={0}
          step={0.01}
          placeholder="No budget"
          defaultValue={
            settings.dailyBudgetMicroUsd === null
              ? ""
              : settings.dailyBudgetMicroUsd / 1e6
          }
          aria-label="Daily budget, in US dollars"
          leftIcon={<span className="text-sm text-muted-foreground">$</span>}
          inputClassName="font-mono"
        />
        <Button type="submit" variant="outline">
          Save
        </Button>
        {settings.dailyBudgetMicroUsd !== null && (
          <Button type="button" variant="ghost" onClick={() => save(null)}>
            Remove
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="text-sm text-primitive-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function CacheBreakConfirm() {
  const settings = useQuery(api.settings.get);
  const setThreshold = useMutation(api.settings.setCacheBreakConfirm);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">
          Cache-break confirmation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Editing a past message throws away the cached history after it. When
          that costs more than this, tally.chat asks before you edit.
        </p>
      </div>
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const dollars = Number(
            new FormData(e.currentTarget).get("threshold"),
          );
          setError(null);
          setThreshold({ microUsd: Math.round(dollars * 1e6) }).catch((err) =>
            setError(
              err instanceof ConvexError ? String(err.data) : "Could not save",
            ),
          );
        }}
      >
        <Input
          key={settings.cacheBreakConfirmMicroUsd}
          name="threshold"
          type="number"
          min={0}
          step={0.01}
          defaultValue={settings.cacheBreakConfirmMicroUsd / 1e6}
          aria-label="Confirm above, in US dollars"
          leftIcon={<span className="text-sm text-muted-foreground">$</span>}
          inputClassName="font-mono"
        />
        <Button type="submit" variant="outline">
          Save
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-primitive-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function TimeZone() {
  const settings = useQuery(api.settings.get);
  const setTimeZone = useMutation(api.settings.setTimeZone);
  if (!settings) return null;
  const zones = Intl.supportedValuesOf("timeZone");

  return (
    <section
      data-surface="panel"
      className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
    >
      <div>
        <h2 className="font-semibold tracking-[-0.01em]">Time zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Where your day starts and ends for daily spend. Changing it applies to
          new calls; past days keep their dates.
        </p>
      </div>
      <NativeSelect
        aria-label="Time zone"
        value={settings.timeZone ?? "UTC"}
        onChange={(e) => void setTimeZone({ timeZone: e.target.value })}
      >
        {(zones.includes("UTC") ? zones : ["UTC", ...zones]).map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll("_", " ")}
          </option>
        ))}
      </NativeSelect>
    </section>
  );
}

export default function SettingsPage() {
  const settings = useQuery(api.settings.get);
  const addHost = useMutation(api.settings.addAllowedHost);
  const removeHost = useMutation(api.settings.removeAllowedHost);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setError(null);
    try {
      await addHost({ host: String(new FormData(formEl).get("host")) });
      formEl.reset();
    } catch (err) {
      setError(
        err instanceof ConvexError ? String(err.data) : "Something went wrong",
      );
    }
  }

  return (
    <ChatShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Settings
          </h1>
          <SideJobModel />
          <Keepalive />
          <Condensing />
          <CacheBreakConfirm />
          <DailyBudget />
          <TimeZone />
          <section
            data-surface="panel"
            className="flex flex-col gap-4 rounded-[var(--primitive-radius-surface)] p-5"
          >
            <div>
              <h2 className="font-semibold tracking-[-0.01em]">
                Private host allowlist
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                By default this server only calls public https addresses, so a
                typed URL can&apos;t reach your network. Hosts listed here are
                allowed anyway, over http too. Add only machines you trust, such
                as Ollama on your LAN.
              </p>
            </div>
            {settings && settings.allowlistedHosts.length > 0 && (
              <ul className="flex flex-col">
                {settings.allowlistedHosts.map((host) => (
                  <li
                    key={host}
                    className="flex items-center justify-between border-t border-border py-2"
                  >
                    <span className="font-mono text-sm">{host}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="hover:text-primitive-destructive"
                      onClick={() => void removeHost({ host })}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form className="flex flex-col gap-2" onSubmit={onSubmit}>
              <div className="flex gap-2">
                <Input
                  inputClassName="font-mono"
                  name="host"
                  placeholder="192.168.1.20:11434"
                  aria-label="Host"
                  required
                />
                <Button type="submit">Add host</Button>
              </div>
              <span className="text-xs text-muted-foreground">
                A host, or host:port to allow only that port.
              </span>
              {error && (
                <p role="alert" className="text-sm text-primitive-destructive">
                  {error}
                </p>
              )}
            </form>
          </section>
        </div>
      </div>
    </ChatShell>
  );
}
