"use client";

import { IconX } from "@tabler/icons-react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/wensity/button";
import { api } from "@/convex/_generated/api";
import { todayIn, usd } from "@/lib/format";

const DISMISSED = "tally.budgetWarningDismissed"; // the day the 80% warning was dismissed

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};

// Soft budget (spec phase 3): a dismissible warning at 80% of today's budget, and at 100% a
// notice that sending is paused, with "override for today". The server enforces the pause.
export default function BudgetBanner() {
  const settings = useQuery(api.settings.get);
  const today = settings ? todayIn(settings.timeZone) : null;
  const budget = useQuery(api.usage.budget, today ? { today } : "skip");
  const override = useMutation(api.settings.overrideBudgetToday);
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!budget?.budgetMicroUsd || budget.overridden || !today) return null;

  const spent = `${usd(budget.spentMicroUsd)} of ${usd(budget.budgetMicroUsd)}`;
  const ratio = budget.spentMicroUsd / budget.budgetMicroUsd;
  if (ratio >= 1) {
    return (
      <div
        role="alert"
        className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--primitive-radius-item)] border border-[var(--primitive-destructive-border)] bg-surface px-3 py-2 text-sm"
      >
        <span>
          <strong className="font-medium">Daily budget reached.</strong>{" "}
          <span className="text-muted-foreground">
            {spent} spent today; sending is paused until tomorrow.
          </span>
        </span>
        <Button size="sm" variant="outline" onClick={() => void override({})}>
          Override for today
        </Button>
      </div>
    );
  }
  if (ratio < 0.8 || dismissed === today) return null;
  return (
    <div
      role="status"
      className="mb-2 flex items-center justify-between gap-2 rounded-[var(--primitive-radius-item)] border border-border bg-surface px-3 py-2 text-sm"
    >
      <span className="text-muted-foreground">
        {Math.round(ratio * 100)}% of today&apos;s budget used ({spent}).
      </span>
      <button
        className="icon-action"
        aria-label="Dismiss for today"
        title="Dismiss for today"
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED, today);
          } catch {}
          setDismissed(today);
        }}
      >
        <IconX />
      </button>
    </div>
  );
}
