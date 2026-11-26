import type { Doc } from "../_generated/dataModel";

// Condensing (spec phase 6): fold all but the most recent turns into a checkpoint summary.

export const CONDENSE_DEFAULTS = {
  enabled: true,
  atTokens: 80_000,
  keepTurns: 6,
  minThreadTokens: 10_000,
  paybackTurns: 10,
};

export type CondenseSettings = typeof CONDENSE_DEFAULTS;

export const condenseSettings = (
  s: Doc<"settings"> | null,
): CondenseSettings => ({
  enabled: s?.condenseEnabled ?? CONDENSE_DEFAULTS.enabled,
  atTokens: s?.condenseAtTokens ?? CONDENSE_DEFAULTS.atTokens,
  keepTurns: s?.condenseKeepTurns ?? CONDENSE_DEFAULTS.keepTurns,
  minThreadTokens:
    s?.condenseMinThreadTokens ?? CONDENSE_DEFAULTS.minThreadTokens,
  paybackTurns: s?.condensePaybackTurns ?? CONDENSE_DEFAULTS.paybackTurns,
});

// The summary's output cap. A summary cut off at it is discarded, never saved.
export const SUMMARY_MAX_TOKENS = 6000;

// Versioned like the system prompts: changing the wording changes every future summary.
export const SUMMARY_PROMPTS: Record<number, string> = {
  1: [
    "You condense a chat between a user and an assistant so it can continue without the full history.",
    "Write a summary in plain text, no preamble. Keep: the user's goals, preferences and constraints;",
    "decisions and conclusions reached; facts, names, numbers, code and file names that later turns may need;",
    "open questions and anything the assistant promised to do. Drop pleasantries and repetition.",
    "If an earlier summary is given, merge it with the new turns into one summary.",
    "Never call tools. Reply with the summary only.",
  ].join(" "),
  2: [
    "You condense a chat between a user and an assistant so it can continue without the full history.",
    "Write the summary in plain text, no preamble, under these headings (skip one that has nothing):",
    "Goals and constraints; Decisions and conclusions; Facts, names, numbers and code; Documents and sources;",
    "Open questions and promises; Current state.",
    "Keep exact values verbatim: numbers, names, identifiers, file paths, URLs, commands and code.",
    "If an earlier summary is given, merge it with the new turns into one summary and do not drop any item that still holds.",
    "Err on the side of including information: later turns may need any detail, so prefer recall over brevity.",
    "Never call tools. Reply with the summary only.",
  ].join(" "),
};
export const CURRENT_SUMMARY_PROMPT_VERSION = 2;

// The index (in branch) of the last message to fold, or null when nothing can be folded.
// Folds whole turns from `cut` (the first message after the latest checkpoint), keeping the
// last `keepTurns` turns verbatim. The last folded turn must end on a finished reply, so a
// question is never folded without its answer.
export function planFold(
  branch: Doc<"messages">[],
  cut: number,
  keepTurns: number,
): number | null {
  const turnStarts = branch
    .map((m, i) => (i >= cut && m.role === "user" ? i : -1))
    .filter((i) => i >= 0);
  for (let folded = turnStarts.length - keepTurns; folded > 0; folded--) {
    const end = turnStarts[folded] - 1;
    const last = branch[end];
    if (last.role === "assistant" && last.status === "done") return end;
  }
  return null;
}

// The folded messages as a role-labelled transcript for the summarizer. Pinned messages stay
// verbatim after the summary, so they're left out; images become placeholders.
export function foldTranscript(messages: Doc<"messages">[]) {
  return messages
    .filter((m) => !m.pinned && m.content !== "")
    .map((m) => {
      const images = m.images?.length
        ? `[${m.images.length} image${m.images.length === 1 ? "" : "s"}] `
        : "";
      return `${m.role === "user" ? "User" : "Assistant"}: ${images}${m.content}`;
    })
    .join("\n\n");
}

export function summaryRequest(
  previousSummary: string | null,
  transcript: string,
) {
  return (
    (previousSummary ? `Earlier summary:\n\n${previousSummary}\n\n` : "") +
    `Conversation to condense:\n\n${transcript}`
  );
}

// Per-token USD prices the veto needs; null when the model has no price.
export type ThreadPrices = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
} | null;
export type SidePrices = { input: number; output: number } | null;

// The cache veto (spec phase 6): how many later turns a condense needs to pay for itself, or
// null when it can't be priced (unpriced or free models), and then the veto doesn't apply.
// One-off cost: the summary call, plus on a caching provider the next request's write of the new
// prefix instead of a read of the old one. Saving per turn: the tokens removed from the prefix, at
// the price paid for them each turn (cache read when cached, input when not).
type CondenseFigures = {
  oldPrefixTokens: number; // what the next send repeats today
  removedTokens: number; // folded turns plus the old summary, minus the new summary
  summaryInputTokens: number; // what the summarizer reads
  summaryTokens: number; // the summary it's expected to write (estimateSummaryTokens)
  caching: boolean;
  thread: ThreadPrices;
  side: SidePrices;
};

// A condense's one-off cost in USD and its payback in turns, or null when it can't be priced.
export function condenseEconomics(
  x: CondenseFigures,
): { costUsd: number; paybackTurns: number } | null {
  if (!x.thread || !x.side || x.thread.input === 0) return null;
  const newPrefix = x.oldPrefixTokens - x.removedTokens;
  const costUsd =
    x.summaryInputTokens * x.side.input +
    x.summaryTokens * x.side.output +
    (x.caching
      ? newPrefix * x.thread.cacheWrite - x.oldPrefixTokens * x.thread.cacheRead
      : 0);
  const perTurn =
    x.removedTokens * (x.caching ? x.thread.cacheRead : x.thread.input);
  return {
    costUsd,
    paybackTurns: perTurn <= 0 ? Infinity : Math.max(0, costUsd / perTurn),
  };
}

export const paybackTurns = (x: CondenseFigures) =>
  condenseEconomics(x)?.paybackTurns ?? null;

// The summary a condense is expected to write: a quarter of what it reads, up to its budget.
// ponytail: a fixed 4:1 guess; measure real summaries on the usage page and tune it if it's off.
export const estimateSummaryTokens = (summaryInputTokens: number) =>
  Math.min(SUMMARY_MAX_TOKENS, Math.ceil(summaryInputTokens / 4));

// Near the context window a thread condenses whatever the veto says: half the window.
export const CONTEXT_WINDOW_SHARE = 0.5;
