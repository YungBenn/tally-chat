import { v, type Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";

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

// Whether requests to this model carry an effort: every Anthropic model, and OpenAI-compatible
// ones only when the owner says the model reasons (answer quality ticket 13).
export const supportsEffort = (
  provider: Pick<Doc<"providers">, "apiStyle" | "models"> | null,
  modelId: string,
) =>
  provider?.apiStyle === "anthropic" ||
  provider?.models.find((m) => m.id === modelId)?.reasoning === true;
