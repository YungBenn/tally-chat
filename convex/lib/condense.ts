import type { Doc } from "../_generated/dataModel";

// Condensing (spec phase 6): fold all but the most recent turns into a checkpoint summary.

export const CONDENSE_DEFAULTS = {
  enabled: true,
  atTokens: 30_000,
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
  minThreadTokens: s?.condenseMinThreadTokens ?? CONDENSE_DEFAULTS.minThreadTokens,
  paybackTurns: s?.condensePaybackTurns ?? CONDENSE_DEFAULTS.paybackTurns,
});

// The summary's output cap. A summary cut off at it is discarded, never saved.
export const SUMMARY_MAX_TOKENS = 2048;

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
};
export const CURRENT_SUMMARY_PROMPT_VERSION = 1;

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

export function summaryRequest(previousSummary: string | null, transcript: string) {
  return (
    (previousSummary ? `Earlier summary:\n\n${previousSummary}\n\n` : "") +
    `Conversation to condense:\n\n${transcript}`
  );
}
