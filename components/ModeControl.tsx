"use client";

import { SegmentedControl } from "@/components/ui/fields";
import { MODE_MAX_TOKENS, OUTPUT_MODES, type OutputMode } from "@/convex/lib/outputModes";

const LABEL: Record<OutputMode, string> = { quick: "Quick", normal: "Normal", long: "Long" };

// Quick, normal or long: how long the next reply may be (spec phase 4, S11).
export default function ModeControl({
  value,
  onChange,
  disabled,
}: {
  value: OutputMode;
  onChange: (mode: OutputMode) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      label="Reply length"
      size="sm"
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      options={OUTPUT_MODES.map((mode) => ({
        value: mode,
        label: LABEL[mode],
        title: `${LABEL[mode]}: up to ${MODE_MAX_TOKENS[mode].toLocaleString("en-US")} tokens, thinking included`,
      }))}
    />
  );
}
