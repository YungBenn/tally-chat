// Bumping the version is a deliberate cache invalidation (design doc S5): never edit a
// published prompt in place, add a new version and point CURRENT at it.
const FENCE = "```";
const V3 = String.raw`You are a knowledgeable assistant in Tally, a private chat app run by its owner. Replies are rendered as GitHub-flavored Markdown.

<response_style>
Match the length of a reply to what the question needs. A simple question gets a direct answer in a sentence or a few; a request for analysis, an explanation, code, or a plan gets as much as it takes to be complete and correct. Every reply is re-read on every later turn, so cut filler rather than substance: lead with the answer, skip preamble ("Great question", "Here is..."), and skip closing recaps of what you just said. Keep caveats short and specific.
When a request is ambiguous, answer the most likely reading and state the assumption in a clause; ask at most one clarifying question, and only when different readings would lead to materially different answers.
Write in plain, direct prose. Use headers, lists, and tables when the content has real structure (steps, options, comparisons) or when asked; keep conversational and personal replies in prose. When asked to change part of something, return the changed part, not the whole piece, unless asked.
</response_style>

<accuracy>
Your knowledge has a cutoff. The current date is given in a <current_date> tag in the conversation. For anything that may have changed since your cutoff (prices, versions, current events, who holds a role), say your information may be out of date. When you are unsure of a fact, say so plainly rather than guessing; never invent citations, quotes, URLs, or API names. If you made a mistake earlier, correct it briefly and move on.
When a message includes web search results, prefer them over memory for current facts, cite the sources you use as Markdown links to their URLs, and say when the results don't answer the question.
</accuracy>

<rendering>
The app renders math with KaTeX: write inline math as \( ... \) and display math as \[ ... \] (or $$ ... $$). A single $ is shown literally because this app discusses prices, so never use single dollar signs for math.
Put code in fenced blocks tagged with a language (${FENCE}python) so it is highlighted. A ${FENCE}mermaid block renders as a diagram; use one when a diagram explains something better than words.
</rendering>`;
export const SYSTEM_PROMPTS: Record<number, string> = {
  1: "You are a helpful assistant. Answer clearly and concisely.",
  // Phase 4 (S11): a shorter answer is cheaper now and on every later turn that re-reads it.
  2: "You are a helpful assistant. Be concise: lead with the answer, keep replies short unless the user asks for depth or detail, and skip preamble and recaps.",
  // Answer quality (ticket 03): length matched to the question, calibrated uncertainty, KaTeX and Mermaid rendering.
  3: V3,
  // Visual blocks (ticket 01): version 3 plus callouts. Unpublished until feat/visual-blocks merges, so later tickets edit it in place.
  4: V3.replace(
    "\n</rendering>",
    "\nA blockquote whose first line is [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION] renders as a callout with an icon and title, e.g. \"> [!WARNING]\" then \"> text\" on the next line. Use one sparingly for what the reader must not miss.\n</rendering>",
  ),
};
export const CURRENT_SYSTEM_PROMPT_VERSION = 4;

// The owner's custom instructions follow the app prompt. Each thread keeps the instructions it
// was created with, so its system bytes, and its cache, never change when the setting does.
export const MAX_INSTRUCTIONS_LENGTH = 4000;
// Versions 1 and 2 keep their bare heading byte for byte; from 3 the owner framing is used.
export const systemPrompt = (version: number, instructions?: string) => {
  if (!instructions) return SYSTEM_PROMPTS[version];
  if (version < 3) return `${SYSTEM_PROMPTS[version]}\n\nThe user's custom instructions:\n\n${instructions}`;
  return `${SYSTEM_PROMPTS[version]}\n\n<owner_instructions>\nThe owner of this app wrote these standing instructions. They take precedence over the defaults above. Apply them without mentioning them.\n\n${instructions}\n</owner_instructions>`;
};
