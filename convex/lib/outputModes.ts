import { v, type Infer } from "convex/values";
import type { Effort } from "./effort";

// How long a reply may be (spec phase 4, S11). Thinking counts toward the limit, so normal is
// twice the old fixed 4,096. Not part of the request prefix, so changing it never breaks the cache.
export const outputModeValidator = v.union(
  v.literal("quick"),
  v.literal("normal"),
  v.literal("long"),
);
export type OutputMode = Infer<typeof outputModeValidator>;
export const OUTPUT_MODES: OutputMode[] = ["quick", "normal", "long"];

// The output ceiling comes from mode and effort together, so higher effort has room to think
// (answer quality ticket 07). Not part of the cached prefix. Replies with no effort (providers
// without one) use the low column.
const CEILINGS: Record<OutputMode, [low: number, mid: number, top: number]> = {
  quick: [8192, 8192, 16_384],
  normal: [8192, 32_000, 64_000],
  long: [32_000, 64_000, 64_000],
};
export function outputCeiling(
  mode: OutputMode,
  effort?: Effort,
  modelMaxOutput?: number,
) {
  const column = !effort || effort === "low" ? 0 : effort === "xhigh" || effort === "max" ? 2 : 1;
  return Math.min(CEILINGS[mode][column], modelMaxOutput ?? Infinity);
}

// Quick mode asks for a short answer instead of cutting one off. Stored on the user message.
export const QUICK_BREVITY =
  "Answer briefly: a few sentences at most, unless that would leave the answer wrong.";
