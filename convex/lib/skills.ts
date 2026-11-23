import { v } from "convex/values";
import { parse } from "yaml";

// Agent Skills format (agentskills.io): a SKILL.md with YAML frontmatter plus optional text files.
export const skillFileValidator = v.object({ path: v.string(), text: v.string() });
export type SkillFile = { path: string; text: string };
export type ParsedSkill = {
  name: string;
  description: string;
  body: string; // SKILL.md after its frontmatter
  files: SkillFile[]; // every other text file, paths relative to the skill folder
  size: number; // UTF-8 bytes of SKILL.md and every kept file
};

// Leaves room under Convex's 1 MiB document limit for the rest of the row.
export const MAX_SKILL_BYTES = 1_000_000;
const NAME = /^[a-z0-9-]+$/;

const bytes = (s: string) => new TextEncoder().encode(s).length;
// Text read from a binary file carries NULs or decoding replacement characters.
const isBinary = (text: string) => /[\u0000�]/.test(text);

/** Finds, parses and validates a skill; a bad one gives the reason the owner sees. */
export function parseSkill(input: SkillFile[]): { ok: true; skill: ParsedSkill } | { ok: false; reason: string } {
  let files = input.map((f) => ({ ...f, path: f.path.replace(/^\.?\/+/, "") }));
  // A folder zipped by the OS puts everything under one top-level folder.
  const top = files[0]?.path.split("/")[0];
  if (files.length && files.every((f) => f.path.startsWith(`${top}/`)))
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));

  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (!skillMd) return { ok: false, reason: "No SKILL.md found at the top of the skill." };

  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(skillMd.text);
  if (!match) return { ok: false, reason: "SKILL.md has no YAML frontmatter (a block between --- lines at the top)." };
  let meta: unknown;
  try {
    meta = parse(match[1]);
  } catch (err) {
    return { ok: false, reason: `SKILL.md frontmatter is not valid YAML: ${(err as Error).message.split("\n")[0]}` };
  }
  const { name, description } = (meta ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name) return { ok: false, reason: "SKILL.md frontmatter has no name." };
  if (!NAME.test(name))
    return { ok: false, reason: `The name "${name}" must be lowercase letters, digits and hyphens only.` };
  if (name.length > 64) return { ok: false, reason: `The name is ${name.length} characters; at most 64 characters are allowed.` };
  if (typeof description !== "string" || !description.trim())
    return { ok: false, reason: "SKILL.md frontmatter has no description." };
  if (description.length > 1024)
    return { ok: false, reason: `The description is ${description.length} characters; at most 1024 characters are allowed.` };

  const rest = files.filter((f) => f !== skillMd && !isBinary(f.text));
  const size = bytes(skillMd.text) + rest.reduce((n, f) => n + bytes(f.text), 0);
  if (size > MAX_SKILL_BYTES)
    return { ok: false, reason: `The skill is ${(size / 1e6).toFixed(1)} MB of text; at most 1 MB is allowed.` };

  return {
    ok: true,
    skill: { name, description: description.trim(), body: skillMd.text.slice(match[0].length), files: rest, size },
  };
}
