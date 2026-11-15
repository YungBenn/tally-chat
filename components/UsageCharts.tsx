"use client";

import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { useEffect, useId, useRef } from "react";
import { HoloGradient } from "@/components/ui/feedback";
import { tiltAngle } from "@/lib/motion";
import { niceCeil } from "@/lib/scale";
import { cn } from "@/lib/utils";

/** One figure: overline label, a mono value, and a signed note. `highlight` marks the page's one hero tile. */
export function StatTile({
  label,
  value,
  note,
  dir,
  highlight,
}: {
  label: string;
  value: string;
  note?: string;
  dir?: "up-good" | "up-bad" | "neg";
  highlight?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The highlighted tile's sheen follows the pointer (motion: pointer sheen); off with reduced motion.
  useEffect(() => {
    const el = ref.current;
    if (!highlight || !el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--holo-angle", tiltAngle((e.clientX - r.left) / r.width - 0.5));
    };
    const leave = () => el.style.setProperty("--holo-angle", "115deg");
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [highlight]);
  return (
    <div ref={ref} className={cn("tc-tile", highlight && "holo-border holo-default")}>
      <div className="text-overline text-foreground-muted uppercase">{label}</div>
      <div className={cn("tc-tile-value", highlight && "holo-text")}>{value}</div>
      {note && (
        <span className="tc-tile-delta" data-dir={dir}>
          {dir === "neg" ? <IconArrowDown size={12} stroke={1.5} /> : dir && <IconArrowUp size={12} stroke={1.5} />}
          {note}
        </span>
      )}
    </div>
  );
}

export type Series = { name: string; color: string; value?: string };

export function Legend({ items }: { items: Series[] }) {
  return (
    <div className="tc-legend">
      {items.map((m) => (
        <span key={m.name}>
          <i className="tc-swatch" style={{ background: m.color }} />
          {m.name}
          {m.value && <b>{m.value}</b>}
        </span>
      ))}
    </div>
  );
}

const W = 560;

/**
 * Stacked bars by day (design system: BarChart): series colors only, never holo; bars grow from
 * the axis staggered 25ms. `format` labels the y axis.
 */
export function BarChart({
  days,
  series,
  values,
  format,
  label,
  dayLabel,
}: {
  days: string[];
  series: Series[];
  values: number[][]; // per day, one value per series
  format: (v: number) => string;
  label: string;
  dayLabel: (day: string) => string;
}) {
  const H = 180;
  const pad = { l: 46, b: 22, t: 8, r: 4 };
  const max = niceCeil(Math.max(...values.map((d) => d.reduce((a, b) => a + b, 0)), 0) || 1);
  const bw = (W - pad.l - pad.r) / Math.max(1, days.length);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.b - pad.t);
  const every = Math.ceil(days.length / 7);
  return (
    <svg className="tc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} />
          <text x={pad.l - 6} y={y(max * f) + 3} textAnchor="end">
            {format(max * f)}
          </text>
        </g>
      ))}
      {values.map((d, i) => {
        const x = pad.l + i * bw + bw * 0.18;
        const w = bw * 0.64;
        let acc = 0;
        return (
          <g key={days[i]}>
            {d.map((v, j) => {
              if (!v) return null;
              const y0 = y(acc);
              const y1 = y(acc + v);
              acc += v;
              return (
                <rect
                  key={j}
                  className="bar"
                  x={x}
                  y={y1}
                  width={w}
                  height={Math.max(1, y0 - y1 - (j ? 1 : 0))}
                  rx={j === 0 ? 0 : 1.5}
                  fill={series[j].color}
                  style={{ animationDelay: `${i * 25}ms` }}
                >
                  <title>{`${dayLabel(days[i])} · ${series[j].name}: ${format(v)}`}</title>
                </rect>
              );
            })}
            {i % every === 0 && (
              <text x={x + w / 2} y={H - 6} textAnchor="middle">
                {dayLabel(days[i])}
              </text>
            )}
          </g>
        );
      })}
      <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
    </svg>
  );
}

/**
 * Cache hit rate over time (design system: LineChart): the one chart line that may shine, drawn
 * in once; the y axis is fixed so the line never jumps. Days without replies leave gaps.
 */
export function LineChart({
  days,
  rates,
  label,
  dayLabel,
}: {
  days: string[];
  rates: (number | null)[]; // 0..1
  label: string;
  dayLabel: (day: string) => string;
}) {
  const id = useId();
  const W = 400;
  const H = 180;
  const pad = { l: 40, b: 22, t: 14, r: 10 };
  const known = rates.filter((r): r is number => r !== null).map((r) => r * 100);
  const lo = known.length && Math.min(...known) < 50 ? 0 : 50;
  const x = (i: number) => pad.l + (i / Math.max(1, rates.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - ((v - lo) / (100 - lo)) * (H - pad.b - pad.t);
  // Days without replies have no rate; the line joins the days that do.
  const points = rates.flatMap((r, i) => (r === null ? [] : [{ i, v: r * 100 }]));
  const d = points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = rates.findLastIndex((r) => r !== null);
  const every = Math.ceil(days.length / 5);
  return (
    <svg className="tc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <HoloGradient id={id} x1={pad.l} x2={W - pad.r} />
      </defs>
      {[lo, (lo + 100) / 2, 100].map((v) => (
        <g key={v}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end">
            {v}%
          </text>
        </g>
      ))}
      {days.map((day, i) =>
        i % every === 0 ? (
          <text key={day} x={x(i)} y={H - 4} textAnchor="middle">
            {dayLabel(day)}
          </text>
        ) : null,
      )}
      <line className="axis" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
      {points.length > 1 && <path className="line" d={d} stroke={`url(#${id})`} pathLength={1} />}
      {points.slice(0, -1).map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2} fill="var(--cached)" />
      ))}
      {last >= 0 && (
        <>
          <circle cx={x(last)} cy={y(rates[last]! * 100)} r={3.5} fill="var(--surface)" stroke="var(--cached)" strokeWidth={1.5} />
          <text x={x(last) - 8} y={y(rates[last]! * 100) - 9} textAnchor="end" style={{ fill: "var(--foreground)" }}>
            {Math.round(rates[last]! * 100)}%
          </text>
        </>
      )}
    </svg>
  );
}
