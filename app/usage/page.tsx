"use client";

import { useQuery } from "convex/react";
import ChatShell from "@/components/ChatShell";
import { api } from "@/convex/_generated/api";
import { usd } from "@/lib/format";

// YYYY-MM-DD now in the owner's time zone (UTC until set), the same day the rollups use.
const todayIn = (timeZone: string | null) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
const pct = (rate: number | null) =>
  rate === null ? "—" : `${Math.round(rate * 100)}%`;
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div
      data-surface="panel"
      className="flex flex-col gap-1 rounded-[var(--primitive-radius-surface)] p-4"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xl tabular-nums">{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-xs tabular-nums">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {head.map((h, i) => (
              <th
                key={h}
                className={`py-2 font-normal ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-border last:border-0">
              {r.map((cell, i) => (
                <td
                  key={i}
                  className={`py-1.5 ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The last 30 days of spend, by day and by model, with cache hit rate, upkeep and savings
// (spec phase 3). Days are the owner's, from the settings time zone.
export default function UsagePage() {
  const settings = useQuery(api.settings.get);
  const data = useQuery(
    api.usage.summary,
    settings ? { today: todayIn(settings.timeZone) } : "skip",
  );

  return (
    <ChatShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Usage</h1>
          {!data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <UsageBody data={data} />
          )}
        </div>
      </div>
    </ChatShell>
  );
}

type Summary = NonNullable<
  ReturnType<typeof useQuery<typeof api.usage.summary>>
>;

function UsageBody({ data }: { data: Summary }) {
  const { days, models } = data;
  const spend = days.reduce((s, d) => s + d.costMicroUsd, 0);
  const upkeep = days.reduce((s, d) => s + d.upkeepMicroUsd, 0);
  const unpriced = days.reduce((s, d) => s + d.unpricedCalls, 0);
  const max = Math.max(...days.map((d) => d.costMicroUsd), 1);
  const active = days.filter((d) => d.calls > 0).reverse();

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Spent, 30 days"
          value={usd(spend)}
          note={unpriced ? "lower bound" : undefined}
        />
        <Stat
          label="Cache saved, 7 days"
          value={usd(data.savedMicroUsd7)}
          note={`30 days: ${usd(data.savedMicroUsd30)}`}
        />
        <Stat
          label="Cache hit rate"
          value={pct(data.hitRate30)}
          note="30 days, replies"
        />
        <Stat
          label="Cache upkeep"
          value={usd(upkeep)}
          note="keepalives, 30 days"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold tracking-[-0.01em]">Daily spend</h2>
        <div
          className="flex h-32 items-end gap-[3px]"
          role="img"
          aria-label={`Daily spend over the last 30 days, up to ${usd(max)} a day`}
        >
          {days.map((d) => (
            <div
              key={d.day}
              title={`${shortDay(d.day)}: ${usd(d.costMicroUsd)}${d.upkeepMicroUsd ? ` (upkeep ${usd(d.upkeepMicroUsd)})` : ""}`}
              className="flex-1 rounded-t-sm bg-foreground/80 hover:bg-foreground"
              style={{
                height: d.costMicroUsd
                  ? `${Math.max(2, (d.costMicroUsd / max) * 100)}%`
                  : "1px",
                opacity: d.costMicroUsd ? 1 : 0.25,
              }}
            />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{shortDay(days[0].day)}</span>
          <span>{shortDay(days[days.length - 1].day)}</span>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold tracking-[-0.01em]">By day</h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calls in the last 30 days.
          </p>
        ) : (
          <Table
            head={["Day", "Spent", "Hit rate", "Upkeep", "Cache saved"]}
            rows={active.map((d) => [
              shortDay(d.day),
              usd(d.costMicroUsd) + (d.unpricedCalls ? "+" : ""),
              pct(d.hitRate),
              usd(d.upkeepMicroUsd),
              usd(d.savedMicroUsd),
            ])}
          />
        )}
      </section>

      {models.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold tracking-[-0.01em]">By model</h2>
          <Table
            head={["Model", "Calls", "Spent"]}
            rows={models.map((m) => [
              m.model,
              String(m.calls),
              m.unpricedCalls === m.calls
                ? "unknown"
                : usd(m.costMicroUsd) + (m.unpricedCalls ? "+" : ""),
            ])}
          />
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Cache saved is the cache-read discount minus cache-write premiums, minus
        keepalive spend; it can go negative.
        {unpriced > 0 &&
          ` ${unpriced} call${unpriced === 1 ? " has" : "s have"} no price, so totals marked + are a lower bound.`}
      </p>
    </>
  );
}
