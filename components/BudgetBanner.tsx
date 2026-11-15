"use client";

import { IconAlertTriangle, IconLock } from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useTodayBudget } from "@/components/BudgetMeter";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { usd } from "@/lib/format";
import { reduced, variants } from "@/lib/motion";

const DISMISSED = "tally.budgetWarningDismissed"; // the day the 80% warning was dismissed

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};

/** Whether today's budget pauses sending (100% reached, no override): the composer goes sunken. */
export function useSendingPaused() {
  const b = useTodayBudget();
  return !!b && b.ratio >= 1 && !b.overridden;
}

/** The banner itself: 80% (dismissible for the day) or 100% (paused, override for today). */
export function BudgetNotice({
  state,
  ratio,
  spent,
  budget,
  onOverride,
  onDismiss,
}: {
  state: "near" | "paused";
  ratio: number;
  spent: number;
  budget: number;
  onOverride: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="tc-banner mb-2" data-tone={state} role="status">
      {state === "paused" ? (
        <IconLock size={16} stroke={1.5} className="tc-banner-icon shrink-0" />
      ) : (
        <IconAlertTriangle
          size={16}
          stroke={1.5}
          className="tc-banner-icon shrink-0"
        />
      )}
      <span className="tc-banner-text">
        {state === "paused" ? (
          <>
            <strong>Daily budget reached.</strong> You spent{" "}
            <span className="tc-num">{usd(spent)}</span> of{" "}
            <span className="tc-num">{usd(budget)}</span>; sending is paused
            until tomorrow.
          </>
        ) : (
          <>
            <strong>
              {Math.round(ratio * 100)}% of today&apos;s budget used.
            </strong>{" "}
            <span className="tc-num">
              {usd(spent)} / {usd(budget)}
            </span>
          </>
        )}
      </span>
      {state === "paused" ? (
        <Button size="sm" onClick={onOverride}>
          Override for today
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss for today
        </Button>
      )}
    </div>
  );
}

// Soft budget (spec phase 3, design system: BudgetBanner): a dismissible warning at 80% of today's
// budget, and at 100% a notice that sending is paused, with "Override for today". The server
// enforces the pause. Opens and closes with variants.banner.
export default function BudgetBanner() {
  const b = useTodayBudget();
  const override = useMutation(api.settings.overrideBudgetToday);
  const [dismissed, setDismissed] = useState(readDismissed);
  const v = useReducedMotion() ? reduced.banner : variants.banner;
  const state =
    !b || b.overridden
      ? null
      : b.ratio >= 1
        ? "paused"
        : b.ratio >= 0.8 && dismissed !== b.today
          ? "near"
          : null;
  return (
    <AnimatePresence initial={false}>
      {b && state && (
        <motion.div
          key={state}
          variants={v}
          initial="initial"
          animate="animate"
          exit="exit"
          className="overflow-hidden"
        >
          <BudgetNotice
            state={state}
            ratio={b.ratio}
            spent={b.spentMicroUsd}
            budget={b.budgetMicroUsd}
            onOverride={() => void override({})}
            onDismiss={() => {
              try {
                localStorage.setItem(DISMISSED, b.today);
              } catch {}
              setDismissed(b.today);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
