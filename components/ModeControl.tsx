"use client";

import { SegmentedControl } from "@/components/ui/fields";
import { OUTPUT_MODES, type OutputMode } from "@/convex/lib/outputModes";

const LABEL: Record<OutputMode, string> = { quick: "Quick", normal: "Normal", long: "Long" };
const HINT: Record<OutputMode, string> = {
  quick: "asks for a short answer",
  normal: "matches length to the question",
  long: "room for very long output",
};

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
        title: `${LABEL[mode]}: ${HINT[mode]}`,
      }))}
    />
  );
}
