import { v, type Infer } from "convex/values";

// How long a reply may be (spec phase 4, S11). Thinking counts toward the limit, so normal is
// twice the old fixed 4,096. Not part of the request prefix, so changing it never breaks the cache.
export const outputModeValidator = v.union(
  v.literal("quick"),
  v.literal("normal"),
  v.literal("long"),
);
export type OutputMode = Infer<typeof outputModeValidator>;
export const OUTPUT_MODES: OutputMode[] = ["quick", "normal", "long"];
export const MODE_MAX_TOKENS: Record<OutputMode, number> = {
  quick: 2048,
  normal: 8192,
  long: 32_000,
};
