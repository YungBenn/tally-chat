import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { parseSkill, skillFileValidator, type ParsedSkill } from "./lib/skills";
import { requireOwner } from "./owner";

const skillView = v.object({
  _id: v.id("skills"),
  name: v.string(),
  description: v.string(),
  size: v.number(),
  source: v.literal("upload"),
  onForNewThreads: v.boolean(),
});

export const addResult = v.union(
  v.object({ status: v.literal("added"), skillId: v.id("skills") }),
  v.object({ status: v.literal("exists"), name: v.string() }), // ask, then add again with replace
  v.object({ status: v.literal("invalid"), reason: v.string() }),
);

async function ownedSkill(ctx: QueryCtx, ownerId: Id<"users">, id: Id<"skills">) {
  const skill = await ctx.db.get("skills", id);
  return skill && skill.ownerId === ownerId ? skill : null;
}

/**
 * Saves a parsed skill under its name. An existing name is only overwritten with `replace`,
 * keeping its id and on-for-new-threads switch. Shared by every way of adding a skill.
 */
export async function saveSkill(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  skill: ParsedSkill,
  replace: boolean,
): Promise<typeof addResult.type> {
  const existing = await ctx.db
    .query("skills")
    .withIndex("by_ownerId_and_name", (q) => q.eq("ownerId", ownerId).eq("name", skill.name))
    .unique();
  if (existing && !replace) return { status: "exists", name: skill.name };
  const fields = { ...skill, source: "upload" as const };
  if (existing) {
    await ctx.db.patch("skills", existing._id, fields);
    return { status: "added", skillId: existing._id };
  }
  return { status: "added", skillId: await ctx.db.insert("skills", { ownerId, onForNewThreads: true, ...fields }) };
}

export const list = query({
  args: {},
  returns: v.array(skillView),
  handler: async (ctx) => {
    const ownerId = await requireOwner(ctx);
    const rows = await ctx.db
      .query("skills")
      .withIndex("by_ownerId_and_name", (q) => q.eq("ownerId", ownerId))
      .take(500);
    return rows.map(({ _id, name, description, size, source, onForNewThreads }) => ({
      _id,
      name,
      description,
      size,
      source,
      onForNewThreads,
    }));
  },
});

export const get = query({
  args: { skillId: v.id("skills") },
  returns: v.union(
    v.null(),
    v.object({
      name: v.string(),
      description: v.string(),
      body: v.string(),
      files: v.array(v.object({ path: v.string(), size: v.number() })),
    }),
  ),
  handler: async (ctx, { skillId }) => {
    const skill = await ownedSkill(ctx, await requireOwner(ctx), skillId);
    if (!skill) return null;
    return {
      name: skill.name,
      description: skill.description,
      body: skill.body,
      files: skill.files.map((f) => ({ path: f.path, size: new TextEncoder().encode(f.text).length })),
    };
  },
});

// A bad skill comes back as a reason, not an error, so the UI can show it inline.
export const addFromFiles = mutation({
  args: { files: v.array(skillFileValidator), replace: v.optional(v.boolean()) },
  returns: addResult,
  handler: async (ctx, { files, replace }) => {
    const ownerId = await requireOwner(ctx);
    const parsed = parseSkill(files);
    if (!parsed.ok) return { status: "invalid" as const, reason: parsed.reason };
    return saveSkill(ctx, ownerId, parsed.skill, replace ?? false);
  },
});

export const setOnForNewThreads = mutation({
  args: { skillId: v.id("skills"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { skillId, on }) => {
    const skill = await ownedSkill(ctx, await requireOwner(ctx), skillId);
    if (!skill) throw new ConvexError("Skill not found");
    await ctx.db.patch("skills", skill._id, { onForNewThreads: on });
    return null;
  },
});

export const remove = mutation({
  args: { skillId: v.id("skills") },
  returns: v.null(),
  handler: async (ctx, { skillId }) => {
    const skill = await ownedSkill(ctx, await requireOwner(ctx), skillId);
    if (!skill) throw new ConvexError("Skill not found");
    await ctx.db.delete("skills", skill._id);
    return null;
  },
});

// What read_skill returns from: the skill as it is now, or null once deleted.
export const forRead = internalQuery({
  args: { ownerId: v.id("users"), name: v.string() },
  returns: v.union(v.null(), v.object({ body: v.string(), files: v.array(skillFileValidator) })),
  handler: async (ctx, { ownerId, name }) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_ownerId_and_name", (q) => q.eq("ownerId", ownerId).eq("name", name))
      .unique();
    return skill && { body: skill.body, files: skill.files };
  },
});
