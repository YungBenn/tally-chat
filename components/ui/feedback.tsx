"use client";

import * as React from "react";
import { IconAlertCircle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** SVG gradient along the holo stops; follows the theme. Give each a unique id (useId). */
export function HoloGradient({
  id,
  x1 = 0,
  y1 = 0,
  x2 = 100,
  y2 = 0,
}: {
  id: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}>
      <stop offset="0" style={{ stopColor: "var(--holo-cyan)" }} />
      <stop offset="0.34" style={{ stopColor: "var(--holo-violet)" }} />
      <stop offset="0.68" style={{ stopColor: "var(--holo-pink)" }} />
      <stop offset="1" style={{ stopColor: "var(--holo-amber)" }} />
    </linearGradient>
  );
}

export function Spinner({ size = 16, label = "Loading" }: { size?: number; label?: string }) {
  const id = React.useId();
  return (
    <span
      className="tc-spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size, color: "var(--foreground-subtle)" }}
    >
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <defs>
          <HoloGradient id={id} x2={16} y2={16} />
        </defs>
        <path
          d="M8 0.75A7.25 7.25 0 0 1 15.25 8"
          stroke={`url(#${id})`}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export type BadgeTone =
  | "cached"
  | "write"
  | "fresh"
  | "live"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

export function Badge({
  tone,
  dot,
  icon,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "tc-badge",
        dot && "tc-badge-dot",
        tone === "live" && "holo-border holo-shimmer",
        className,
      )}
      data-tone={tone}
    >
      {icon}
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="tc-kbd">{children}</kbd>;
}

/**
 * Determinate meter: holo fill under 80%, budget-near at 80%, budget-paused at 100%. `plain` is
 * ordinary progress (an import), holo all the way.
 */
export function ProgressBar({
  value = 0,
  indeterminate,
  plain,
  label,
  className,
}: {
  value?: number;
  indeterminate?: boolean;
  plain?: boolean;
  label?: string;
  className?: string;
}) {
  const tone = plain ? undefined : value >= 100 ? "paused" : value >= 80 ? "near" : undefined;
  return (
    <div
      className={cn("tc-progress", indeterminate && "tc-progress-indeterminate", className)}
      data-tone={tone}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i className={tone ? undefined : "holo-fill"} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function Divider({ holo, label }: { holo?: boolean; label?: React.ReactNode }) {
  if (label)
    return (
      <div className="tc-divider-label" role="separator">
        {label}
      </div>
    );
  return <hr className={cn("tc-divider", holo && "tc-divider-holo")} />;
}

export function Skeleton({ width = "100%", height = 12 }: { width?: number | string; height?: number }) {
  return <div className="tc-skeleton" style={{ width, height }} />;
}

/** Hairline grid, a tally glyph that draws itself in once, a title, one sentence and one action. */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn("tc-empty", className)}>
      <div className="tc-grid-bg" />
      <div style={{ position: "relative" }}>
        <svg className="tc-draw" width={56} height={40} viewBox="0 0 56 40" fill="none" aria-hidden>
          <defs>
            <HoloGradient id={id} x2={56} y2={40} />
          </defs>
          <path
            d="M8 6v28M16 6v28M24 6v28M32 6v28"
            stroke={`url(#${id})`}
            strokeWidth={1.5}
            strokeLinecap="round"
            pathLength={1}
          />
          <path
            d="M4 28L38 10"
            stroke={`url(#${id})`}
            strokeWidth={1.5}
            strokeLinecap="round"
            pathLength={1}
            style={{ animationDelay: "0.5s" }}
          />
          <path d="M44 34h8" stroke="var(--border-strong)" strokeWidth={1} strokeLinecap="round" pathLength={1} />
        </svg>
        <h4>{title}</h4>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

/** Inline error: what failed, the provider's code, whether anything was charged, and a retry. */
export function ErrorState({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("tc-error", className)} role="alert">
      <IconAlertCircle size={18} stroke={1.5} className="tc-error-icon" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tc-error-title">{title}</div>
        {children != null && <div className="tc-error-body">{children}</div>}
        {actions && (
          <div className="tc-row" style={{ marginTop: "0.625rem", gap: "0.5rem" }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
