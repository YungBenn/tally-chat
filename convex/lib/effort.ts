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
// Threads from before per-model defaults, and unknown models, run at `low`.
export const DEFAULT_EFFORT: Effort = "low";
const MEDIUM_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-2"]);
// A new thread's starting effort. Proxies prefix ids ("cc/claude-opus-5-5"); match the last segment.
export const defaultEffortFor = (modelId: string): Effort =>
  MEDIUM_MODELS.has(modelId.split("/").at(-1) ?? modelId)
    ? "medium"
    : DEFAULT_EFFORT;
