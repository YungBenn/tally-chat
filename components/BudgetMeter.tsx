"use client";

import { useQuery } from "convex/react";
import { Badge, ProgressBar } from "@/components/ui/feedback";
import { api } from "@/convex/_generated/api";
import { todayIn, usd } from "@/lib/format";

/** Today's spend against the daily budget, or null while loading or with no budget set. */
export function useTodayBudget() {
  const settings = useQuery(api.settings.get);
  const today = settings ? todayIn(settings.timeZone) : null;
  const budget = useQuery(api.usage.budget, today ? { today } : "skip");
  if (!today || !budget?.budgetMicroUsd) return null;
  const ratio = budget.spentMicroUsd / budget.budgetMicroUsd;
  return { ...budget, budgetMicroUsd: budget.budgetMicroUsd, ratio, today };
}

/** The sidebar's compact meter: amount, bar, and a status badge that mirrors the budget banner. */
export default function BudgetMeter() {
  const b = useTodayBudget();
  if (!b) return null;
  const pct = Math.round(b.ratio * 100);
  return (
    <div className="mx-1.5 mt-2.5 flex flex-col gap-2 rounded-popover border border-border bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-overline text-foreground-muted uppercase">Today</span>
        <span className="tc-mono text-mono-sm text-foreground">{usd(b.spentMicroUsd)}</span>
        <span className="tc-mono text-mono-sm text-foreground-muted">/ {usd(b.budgetMicroUsd)}</span>
      </div>
      <ProgressBar value={pct} label={`${pct}% of today's budget`} />
      {b.overridden ? (
        <div>
          <Badge tone="info" dot>
            Override on for today
          </Badge>
        </div>
      ) : b.ratio >= 1 ? (
        <div>
          <Badge tone="danger" dot>
            Sending paused
          </Badge>
        </div>
      ) : b.ratio >= 0.8 ? (
        <div>
          <Badge tone="warning" dot>
            Near limit
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
