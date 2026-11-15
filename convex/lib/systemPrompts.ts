// Bumping the version is a deliberate cache invalidation (design doc S5): never edit a
// published prompt in place, add a new version and point CURRENT at it.
export const SYSTEM_PROMPTS: Record<number, string> = {
  1: "You are a helpful assistant. Answer clearly and concisely.",
  // Phase 4 (S11): a shorter answer is cheaper now and on every later turn that re-reads it.
  2: "You are a helpful assistant. Be concise: lead with the answer, keep replies short unless the user asks for depth or detail, and skip preamble and recaps.",
};
export const CURRENT_SYSTEM_PROMPT_VERSION = 2;
