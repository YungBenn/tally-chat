"use node";

import { lookup } from "node:dns/promises";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { resolveGithubSkill } from "./lib/github";
import { parseSkill, type ParsedSkill } from "./lib/skills";
import { requireOwner } from "./owner";
import { addResult } from "./skills";

type AddResult = typeof addResult.type;

const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

// Fetches and validates a GitHub skill; a bad URL, a GitHub error or a bad skill comes back as a reason.
async function fetchSkill(
  ctx: ActionCtx,
  ownerId: Id<"users">,
  url: string,
): Promise<{ ok: true; skill: ParsedSkill; source: string } | { ok: false; reason: string }> {
  const allowlist: string[] = await ctx.runQuery(internal.settings.allowlist, { ownerId });
  const fetched = await resolveGithubSkill(url, { allowlist, resolve: systemResolve });
  if (!fetched.ok) return fetched;
  const parsed = parseSkill(fetched.files);
  return parsed.ok ? { ok: true, skill: parsed.skill, source: fetched.source } : parsed;
}

export const addFromGithub = action({
  args: { url: v.string(), replace: v.optional(v.boolean()) },
  returns: addResult,
  handler: async (ctx, { url, replace }): Promise<AddResult> => {
    const ownerId = await requireOwner(ctx);
    const got = await fetchSkill(ctx, ownerId, url);
    if (!got.ok) return { status: "invalid", reason: got.reason };
    return ctx.runMutation(internal.skills.save, {
      ownerId,
      skill: got.skill,
      replace: replace ?? false,
      source: { github: got.source },
    });
  },
});

// Pulls the latest version from the stored URL. The name must stay the same, so threads whose
// catalog lists the skill keep reading the right one.
export const refresh = action({
  args: { skillId: v.id("skills") },
  returns: addResult,
  handler: async (ctx, { skillId }): Promise<AddResult> => {
    const ownerId = await requireOwner(ctx);
    const current = await ctx.runQuery(internal.skills.getOwned, { ownerId, skillId });
    if (!current) throw new ConvexError("Skill not found");
    if (current.source === "upload") throw new ConvexError("Only GitHub skills can be refreshed");
    const got = await fetchSkill(ctx, ownerId, current.source.github);
    if (!got.ok) return { status: "invalid", reason: got.reason };
    if (got.skill.name !== current.name)
      return {
        status: "invalid",
        reason: `The skill is now named "${got.skill.name}", not "${current.name}". Add it as a new skill instead.`,
      };
    return ctx.runMutation(internal.skills.save, { ownerId, skill: got.skill, replace: true, source: current.source });
  },
});
