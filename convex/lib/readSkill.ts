import { internal } from "../_generated/api";
import type { BuiltinTool } from "./builtinTools";
import { toolError as error } from "./toolParts";

// read_skill (ADR 0005): its description is the thread's skill catalog, frozen at the first send.
const MAX_CATALOG = 100;
const PREAMBLE =
  "Skills are instructions for specific tasks. Before doing a task that matches a skill below, " +
  "call this tool with the skill's name and follow what it returns. " +
  "A skill may refer to its other files: read one by passing its path.\n\nSkills:\n";
const INPUT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    name: { type: "string", description: "The skill's name, from the list" },
    path: { type: "string", description: "A file of the skill to read instead of its instructions" },
  },
  required: ["name"],
});

export const readSkill: BuiltinTool = {
  name: "read_skill",
  approval: "never",
  // The first 100 by name of the picked skills, or of those on for new threads.
  definition: async (ctx, ownerId, pick) => {
    const lines: string[] = [];
    const skills: string[] = [];
    // ponytail: reads whole skill docs to get names; a slim catalog table if owners hit read limits
    for await (const skill of ctx.db
      .query("skills")
      .withIndex("by_ownerId_and_name", (q) => q.eq("ownerId", ownerId))) {
      if (!(pick.skills ? pick.skills.includes(skill.name) : skill.onForNewThreads)) continue;
      lines.push(`- ${skill.name}: ${skill.description}`);
      skills.push(skill.name);
      if (skills.length === MAX_CATALOG) break;
    }
    if (!skills.length) return null;
    return { description: PREAMBLE + lines.join("\n"), inputSchema: INPUT_SCHEMA, skills };
  },
  run: async (ctx, { ownerId, input, skills = [] }) => {
    const { name, path } = JSON.parse(input) as { name: string; path?: string };
    if (!skills.includes(name))
      return error(`there is no skill called ${name} in this thread. Skills: ${skills.join(", ")}`);
    const skill = await ctx.runQuery(internal.skills.forRead, { ownerId, name });
    if (!skill) return error("this skill was removed");
    if (path === undefined || path === "SKILL.md") return { text: skill.body, status: "ok" };
    const file = skill.files.find((f) => f.path === path);
    if (!file)
      return error(`${name} has no file ${path}. Files: ${["SKILL.md", ...skill.files.map((f) => f.path)].join(", ")}`);
    return { text: file.text, status: "ok" };
  },
};
