"use client";

import { IconMessagePlus } from "@tabler/icons-react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import ChatShell from "@/components/ChatShell";
import { useTodayBudget } from "@/components/BudgetMeter";
import { BarChart, Legend, LineChart, StatTile, type Series } from "@/components/UsageCharts";
import { Badge, EmptyState, ProgressBar } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/fields";
import { api } from "@/convex/_generated/api";
import { todayIn, usd } from "@/lib/format";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
const signed = (micro: number) => `${micro > 0 ? "+" : ""}${usd(micro)}`;
const savingsColor = (micro: number) =>
  micro < 0 ? "var(--savings-negative)" : micro > 0 ? "var(--savings-positive)" : undefined;
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

type Summary = NonNullable<ReturnType<typeof useQuery<typeof api.usage.summary>>>;

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`tc-panel-card ${className ?? ""}`}>
      <h2 className="text-subheading">{title}</h2>
      {children}
    </section>
  );
}

// The last 7 or 30 days of spend, by day and by model, with cache hit rate, upkeep and savings
// (spec phase 3). Days are the owner's, from the settings time zone.
export default function UsagePage() {
  const settings = useQuery(api.settings.get);
  const today = settings ? todayIn(settings.timeZone) : null;
  const data = useQuery(api.usage.summary, today ? { today } : "skip");
  const [range, setRange] = useState<"7d" | "30d">("30d");
  const empty = data && data.days.every((d) => d.calls === 0);

  return (
    <ChatShell>
      <div className="tc-page tc-grid-bg">
        <div className="tc-page-col max-w-[1040px]">
          <div className="flex items-center gap-3">
            <h1 className="flex-1 text-title">Usage</h1>
            {data && !empty && (
              <SegmentedControl
                label="Range"
                size="sm"
                value={range}
                onValueChange={setRange}
                options={[
                  { value: "7d", label: "7 days" },
                  { value: "30d", label: "30 days" },
                ]}
              />
            )}
          </div>
          <BudgetRow />
          {!data ? (
            <p className="text-body-sm text-foreground-muted">Loading…</p>
          ) : empty ? (
            <EmptyState
              title="No usage yet"
              description="Send a message and what it cost shows up here, by day and by model."
              action={
                <Link href="/" className="tc-btn tc-btn-primary holo-border holo-sweep">
                  <IconMessagePlus size={16} stroke={1.5} />
                  Start a thread
                </Link>
              }
            />
          ) : (
            <UsageBody data={data} days={range === "7d" ? 7 : 30} />
          )}
        </div>
      </div>
    </ChatShell>
  );
}

// Today's spend against the soft budget, when one is set.
function BudgetRow() {
  const b = useTodayBudget();
  if (!b) return null;
  const used = Math.round(b.ratio * 100);
  return (
    <div className="tc-panel-card gap-2!">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-overline text-foreground-muted uppercase">Today&apos;s budget</p>
        {b.overridden && <Badge tone="info">Override on for today</Badge>}
        <span className="tc-mono text-mono-sm">
          {usd(b.spentMicroUsd)} of {usd(b.budgetMicroUsd)}
        </span>
      </div>
      <ProgressBar value={used} label={`${used}% of today's budget used`} />
    </div>
  );
}

function UsageBody({ data, days: n }: { data: Summary; days: 7 | 30 }) {
  const days = data.days.slice(-n);
  const spend = days.reduce((s, d) => s + d.costMicroUsd, 0);
  const upkeep = days.reduce((s, d) => s + d.upkeepMicroUsd, 0);
  const unpriced = days.reduce((s, d) => s + d.unpricedCalls, 0);
  const calls = days.reduce((s, d) => s + d.calls, 0);
  const replied = days.filter((d) => d.hitRate !== null);
  // Weighted by calls, like the summary's own 30-day rate.
  const hitRate =
    n === 30
      ? data.hitRate30
      : replied.length
        ? replied.reduce((s, d) => s + d.hitRate! * d.calls, 0) / replied.reduce((s, d) => s + d.calls, 0)
        : null;
  const saved = n === 7 ? data.savedMicroUsd7 : data.savedMicroUsd30;
  const active = days.filter((d) => d.calls > 0).reverse();
  const totalModels = data.models.reduce((s, m) => s + m.costMicroUsd, 0) || 1;
  const series: Series[] = [
    { name: "Replies and side jobs", color: SERIES[0], value: usd(spend - upkeep) },
    { name: "Keepalive", color: SERIES[1], value: usd(upkeep) },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Spent, ${n} days`} value={usd(spend)} note={unpriced ? "lower bound" : `${calls} calls`} />
        <StatTile
          label={`Cache saved, ${n} days`}
          value={signed(saved)}
          note={saved < 0 ? "writes outweighed reads" : "vs no cache"}
          dir={saved < 0 ? "neg" : "up-good"}
          highlight
        />
        <StatTile label="Cache hit rate" value={pct(hitRate)} note="replies" />
        <StatTile label="Cache upkeep" value={usd(upkeep)} note="keepalives" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Daily spend">
          <BarChart
            days={days.map((d) => d.day)}
            series={series}
            values={days.map((d) => [Math.max(0, d.costMicroUsd - d.upkeepMicroUsd), d.upkeepMicroUsd])}
            format={(v) => usd(Math.round(v))}
            label={`Daily spend over the last ${n} days`}
            dayLabel={shortDay}
          />
          <Legend items={series} />
        </Card>
        <Card title="Cache hit rate">
          <LineChart
            days={days.map((d) => d.day)}
            rates={days.map((d) => d.hitRate)}
            label={`Cache hit rate by day, last ${n} days`}
            dayLabel={shortDay}
          />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="By day">
          <div className="tc-table-scroll">
            <table className="tc-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="n">Spent</th>
                  <th className="n">Hit rate</th>
                  <th className="n">Upkeep</th>
                  <th className="n">Cache saved</th>
                </tr>
              </thead>
              <tbody>
                {active.map((d) => (
                  <tr key={d.day}>
                    <td>{shortDay(d.day)}</td>
                    <td className="n">
                      {usd(d.costMicroUsd)}
                      {d.unpricedCalls ? "+" : ""}
                    </td>
                    <td className="n">{pct(d.hitRate)}</td>
                    <td className="n">{usd(d.upkeepMicroUsd)}</td>
                    <td className="n" style={{ color: savingsColor(d.savedMicroUsd) }}>
                      {signed(d.savedMicroUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="By model, 30 days">
          <div className="tc-table-scroll">
            <table className="tc-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="n">Calls</th>
                  <th className="n">Spent</th>
                  <th className="bar-cell">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m, i) => (
                  <tr key={m.model}>
                    <td>
                      <span className="inline-flex max-w-56 items-center gap-2">
                        <i className="tc-swatch" style={{ background: SERIES[Math.min(i, 5)] }} />
                        <span className="truncate">{m.model}</span>
                      </span>
                    </td>
                    <td className="n">{m.calls}</td>
                    <td className="n" style={{ color: "var(--foreground)" }}>
                      {m.unpricedCalls === m.calls ? "unknown" : usd(m.costMicroUsd) + (m.unpricedCalls ? "+" : "")}
                    </td>
                    <td className="bar-cell">
                      <div className="tc-mini-bar">
                        <i style={{ width: `${(m.costMicroUsd / totalModels) * 100}%`, background: SERIES[Math.min(i, 5)] }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <p className="text-caption text-foreground-subtle">
        Cache saved is the cache-read discount minus cache-write premiums, minus keepalive spend; it can go negative.
        {unpriced > 0 &&
          ` ${unpriced} call${unpriced === 1 ? " has" : "s have"} no price, so totals marked + are a lower bound.`}
      </p>
    </>
  );
}
