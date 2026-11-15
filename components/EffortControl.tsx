"use client";

import { Menu, MenuItem, MenuLabel } from "@/components/ui/overlay";
import { EFFORT_LEVELS, type Effort } from "@/convex/lib/effort";

const HEIGHTS = [4, 6, 8, 10, 12];

/** Rising bars, one per level up to the current one. */
export function EffortBars({ level }: { level: Effort }) {
  const n = EFFORT_LEVELS.indexOf(level) + 1;
  return (
    <span className="tc-effort" aria-hidden>
      {HEIGHTS.map((h, i) => (
        <i key={i} data-on={i < n ? "true" : "false"} style={{ height: h }} />
      ))}
    </span>
  );
}

// Effort in the composer (spec phase 4): shows the level in force; a pending change applies from
// the next message on.
export default function EffortControl({
  value,
  pending,
  perMessage,
  onChange,
  disabled,
}: {
  value: Effort;
  pending?: boolean;
  perMessage?: boolean;
  onChange: (effort: Effort) => void;
  disabled?: boolean;
}) {
  const note =
    perMessage === undefined
      ? "How hard the model thinks. Fixed for the thread; higher costs more."
      : perMessage
        ? "From your next message on. Changing it keeps the cache."
        : "For this thread. This model can't change it per message, so changing it writes the history to the cache again.";
  return (
    <Menu
      side="top"
      trigger={
        <button
          type="button"
          className="tc-picker"
          data-pending={pending ? "true" : undefined}
          aria-label={`Effort ${value}${pending ? ", from your next message" : ""}`}
          disabled={disabled}
        >
          <EffortBars level={value} />
          {value}
        </button>
      }
      className="w-72"
    >
      <MenuLabel>Effort</MenuLabel>
      {EFFORT_LEVELS.map((level) => (
        <MenuItem key={level} check={level === value} onClick={() => onChange(level)}>
          {level}
        </MenuItem>
      ))}
      <p className="px-2 pt-1 pb-2 text-caption text-foreground-subtle">{note}</p>
    </Menu>
  );
}
