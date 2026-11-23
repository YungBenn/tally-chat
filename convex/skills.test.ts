/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  return { t, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
}

const skillMd = (name: string, description: string, body = "Do the thing.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

describe("adding a skill from files", () => {
  test("a SKILL.md upload is listed with its name, description, size and source, on by default", async () => {
    const { owner } = await setup();
    const text = skillMd("house-style", "Write in the house style.");
    const result = await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text }] });
    expect(result).toMatchObject({ status: "added" });

    expect(await owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({
        name: "house-style",
        description: "Write in the house style.",
        size: text.length,
        source: "upload",
        onForNewThreads: true,
      }),
    ]);
  });

  test("get returns the body after the frontmatter and the file list", async () => {
    const { owner } = await setup();
    await owner.mutation(api.skills.addFromFiles, {
      files: [
        { path: "SKILL.md", text: skillMd("review", "A review checklist.", "# Review\nCheck it.\n") },
        { path: "refs/checklist.md", text: "- one\n- two\n" },
      ],
    });
    const [{ _id }] = await owner.query(api.skills.list, {});
    expect(await owner.query(api.skills.get, { skillId: _id })).toEqual({
      name: "review",
      description: "A review checklist.",
      body: "# Review\nCheck it.\n",
      files: [{ path: "refs/checklist.md", size: 12 }],
    });
  });

  test("one shared top-level folder is flattened; binary files are dropped; size counts UTF-8 bytes", async () => {
    const { owner } = await setup();
    const text = skillMd("cafe-notes", "x") + "é\n";
    await owner.mutation(api.skills.addFromFiles, {
      files: [
        { path: "cafe-notes/SKILL.md", text },
        { path: "cafe-notes/logo.png", text: "\u0089PNG\r\n\u001a\n\u0000\u0000" },
        { path: "cafe-notes/docs/a.md", text: "a" },
      ],
    });
    const [skill] = await owner.query(api.skills.list, {});
    expect(skill.size).toBe(new TextEncoder().encode(text).length + 1);
    expect((await owner.query(api.skills.get, { skillId: skill._id }))!.files).toEqual([{ path: "docs/a.md", size: 1 }]);
  });

  test("frontmatter is real YAML: quoted and folded descriptions work", async () => {
    const { owner } = await setup();
    const text = '---\nname: "pdf"\ndescription: >-\n  Fill PDF forms:\n  extract fields.\nlicense: MIT\n---\nBody';
    expect(await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text }] })).toMatchObject({ status: "added" });
    expect((await owner.query(api.skills.list, {}))[0].description).toBe("Fill PDF forms: extract fields.");
  });

  test.each([
    ["no SKILL.md", [{ path: "README.md", text: "hi" }], "No SKILL.md"],
    ["no frontmatter", [{ path: "SKILL.md", text: "# Just markdown" }], "frontmatter"],
    ["broken YAML", [{ path: "SKILL.md", text: "---\nname: [x\n---\n" }], "frontmatter"],
    ["uppercase name", [{ path: "SKILL.md", text: skillMd("House-Style", "d") }], "lowercase letters, digits and hyphens"],
    ["name with spaces", [{ path: "SKILL.md", text: skillMd("house style", "d") }], "lowercase letters, digits and hyphens"],
    ["name over 64", [{ path: "SKILL.md", text: skillMd("a".repeat(65), "d") }], "64 characters"],
    ["missing name", [{ path: "SKILL.md", text: "---\ndescription: d\n---\n" }], "name"],
    ["missing description", [{ path: "SKILL.md", text: "---\nname: ok\n---\n" }], "description"],
    ["description over 1024", [{ path: "SKILL.md", text: skillMd("ok", "d".repeat(1025)) }], "1024 characters"],
    ["over 1 MB", [{ path: "SKILL.md", text: skillMd("big", "d") }, { path: "big.txt", text: "x".repeat(1_000_000) }], "1.0 MB"],
  ])("rejected with the reason: %s", async (_, files, reason) => {
    const { owner } = await setup();
    const result = await owner.mutation(api.skills.addFromFiles, { files });
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.reason).toContain(reason);
    expect(await owner.query(api.skills.list, {})).toEqual([]);
  });
});

describe("managing skills", () => {
  test("adding an existing name asks first; with replace it replaces and keeps the switch", async () => {
    const { owner } = await setup();
    await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd("notes", "Old.") }] });
    const [{ _id }] = await owner.query(api.skills.list, {});
    await owner.mutation(api.skills.setOnForNewThreads, { skillId: _id, on: false });

    const files = [{ path: "SKILL.md", text: skillMd("notes", "New.") }];
    expect(await owner.mutation(api.skills.addFromFiles, { files })).toEqual({ status: "exists", name: "notes" });
    expect((await owner.query(api.skills.list, {}))[0].description).toBe("Old.");

    expect(await owner.mutation(api.skills.addFromFiles, { files, replace: true })).toMatchObject({ status: "added" });
    expect(await owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({ _id, description: "New.", onForNewThreads: false }),
    ]);
  });

  test("list is sorted by name; toggle and remove work; another owner can't see or touch them", async () => {
    const { t, owner } = await setup();
    await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd("zeta", "z") }] });
    await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd("alpha", "a") }] });
    const list = await owner.query(api.skills.list, {});
    expect(list.map((s) => s.name)).toEqual(["alpha", "zeta"]);

    await owner.mutation(api.skills.setOnForNewThreads, { skillId: list[0]._id, on: false });
    expect((await owner.query(api.skills.list, {}))[0].onForNewThreads).toBe(false);

    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other" }));
    const other = t.withIdentity({ subject: `${otherId}|session` });
    expect(await other.query(api.skills.list, {})).toEqual([]);
    expect(await other.query(api.skills.get, { skillId: list[0]._id })).toBeNull();
    await expect(other.mutation(api.skills.remove, { skillId: list[0]._id })).rejects.toThrow("not found");
    // Names are unique per owner, not globally.
    expect(await other.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd("alpha", "a") }] })).toMatchObject({ status: "added" });

    await owner.mutation(api.skills.remove, { skillId: list[0]._id });
    expect((await owner.query(api.skills.list, {})).map((s) => s.name)).toEqual(["zeta"]);
    expect(await owner.query(api.skills.get, { skillId: list[0]._id })).toBeNull();
  });
});
