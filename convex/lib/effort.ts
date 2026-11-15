import { v, type Infer } from "convex/values";

// How hard the model thinks (spec phase 4, S7): Anthropic's `output_config.effort`. The 5.5 models
// can't turn thinking off, so effort is the one control; new threads start at `low`.
export const effortValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("xhigh"),
  v.literal("max"),
);
export type Effort = Infer<typeof effortValidator>;
export const EFFORT_LEVELS: Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const DEFAULT_EFFORT: Effort = "low";
