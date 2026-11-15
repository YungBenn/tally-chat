"use client";

import {
  MODE_MAX_TOKENS,
  OUTPUT_MODES,
  type OutputMode,
} from "@/convex/lib/outputModes";
import { cn } from "@/lib/utils";

const LABEL: Record<OutputMode, string> = {
  quick: "Quick",
  normal: "Normal",
  long: "Long",
};

// Quick, normal or long: how long the next reply may be (spec phase 4, S11).
export default function ModeControl({
  value,
  onChange,
}: {
  value: OutputMode;
  onChange: (mode: OutputMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reply length"
      className="inline-flex rounded-full border border-border p-0.5"
    >
      {OUTPUT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          title={`${LABEL[mode]}: up to ${MODE_MAX_TOKENS[mode].toLocaleString("en-US")} tokens, thinking included`}
          onClick={() => onChange(mode)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primitive-ring)] focus-visible:outline-none",
            value === mode
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
