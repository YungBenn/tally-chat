import { internal } from "../_generated/api";
import type { BuiltinTool } from "./builtinTools";
import { fetchGithubSkill } from "./github";
import { parseSkill, skillHash, type ParsedSkill, type SkillSource } from "./skills";
import { toolError as error } from "./toolParts";
import type { GuardOptions } from "./urlGuard";

// add_skill (ADR 0005): adds a skill from chat. The call is resolved before the owner is asked,
// so the approval card shows what will be added; it always asks.
const DESCRIPTION =
  "Add a skill to tally.chat for the user, from a GitHub URL (a repo, a folder or a SKILL.md file) " +
  "or the full text of a SKILL.md. The user sees the skill and approves it first. " +
  "The skill is available from the user's next thread, not this one.";
const INPUT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    source: {
      type: "string",
      description: "A GitHub URL to the skill, or the whole SKILL.md text starting with its --- frontmatter",
    },
  },
  required: ["source"],
});

// Text starting with frontmatter is a SKILL.md; anything else is a GitHub URL.
async function resolve(
  input: string,
  guard: GuardOptions,
): Promise<{ ok: true; skill: ParsedSkill; source: SkillSource } | { ok: false; reason: string }> {
  const { source } = JSON.parse(input) as { source?: unknown };
  if (typeof source !== "string") return { ok: false, reason: "source must be a GitHub URL or SKILL.md text." };
  const text = source.trimStart();
  if (text.startsWith("---")) {
    const parsed = parseSkill([{ path: "SKILL.md", text }]);
    return parsed.ok ? { ok: true, skill: parsed.skill, source: "upload" } : parsed;
  }
  const got = await fetchGithubSkill(source, guard);
  return got.ok ? { ok: true, skill: got.skill, source: { github: got.source } } : got;
}

export const addSkill: BuiltinTool = {
  name: "add_skill",
  approval: "always",
  // Always offered: its owner setting only decides whether new threads pick it by default.
  definition: async () => ({ description: DESCRIPTION, inputSchema: INPUT_SCHEMA }),
  preview: async (input, guard) => {
    const got = await resolve(input, guard);
    if (!got.ok) return { error: got.reason };
    const { name, description, size } = got.skill;
    return { name, description, size, source: got.source, hash: await skillHash(got.skill) };
  },
  // Runs only once approved, or with the resolve error that skipped asking. The source is fetched
  // again and must still hash to what the owner approved.
  run: async (ctx, { ownerId, input, preview, guard }) => {
    if (!preview || "error" in preview) return error(preview?.error ?? "the skill was not resolved.");
    const got = await resolve(input, guard);
    if (!got.ok) return error(got.reason);
    const { name } = got.skill;
    if (!preview.hash || (await skillHash(got.skill)) !== preview.hash)
      return error("the skill changed after it was shown for approval, so it was not added. Call add_skill again to show the new version.");
    // Only replaces when the approved preview said so.
    const saved = await ctx.runMutation(internal.skills.save, {
      ownerId,
      skill: got.skill,
      replace: preview.replaces === true,
      source: got.source,
    });
    if (saved.status !== "added")
      return error(
        `a skill named ${name} was added after this was shown for approval, so it was not replaced. Call add_skill again to replace it.`,
      );
    return { text: `Added the skill ${name}. It is available from the next thread, not this one.`, status: "ok" };
  },
};
