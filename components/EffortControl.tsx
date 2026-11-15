"use client";

import { EFFORT_LEVELS, type Effort } from "@/convex/lib/effort";
import { cn } from "@/lib/utils";

// Effort in the composer (spec phase 4): shows the level in force; a pending change applies from
// the next message on.
export default function EffortControl({
  value,
  pending,
  perMessage,
  onChange,
}: {
  value: Effort;
  pending: boolean;
  perMessage: boolean;
  onChange: (effort: Effort) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
        pending
          ? "border-foreground text-foreground"
          : "border-border text-muted-foreground",
      )}
      title={
        perMessage
          ? "Effort from your next message on. Changing it keeps the cache."
          : "Effort for this thread. This model can't change it per message, so changing it writes the history to the cache again."
      }
    >
      <span>effort</span>
      <select
        aria-label="Effort"
        value={value}
        onChange={(e) => onChange(e.target.value as Effort)}
        className="cursor-pointer bg-transparent font-medium text-foreground focus-visible:outline-none"
      >
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>
    </label>
  );
}
