// Bumping the version is a deliberate cache invalidation (design doc S5): never edit a
// published prompt in place, add a new version and point CURRENT at it.
export const SYSTEM_PROMPTS: Record<number, string> = {
  1: "You are a helpful assistant. Answer clearly and concisely.",
};
export const CURRENT_SYSTEM_PROMPT_VERSION = 1;
