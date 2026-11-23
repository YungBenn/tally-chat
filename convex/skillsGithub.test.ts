/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { api } from "./_generated/api";
import schema from "./schema";

const dns = vi.hoisted(() => ({ address: "140.82.112.3" }));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: dns.address, family: 4 }] }));
const modules = import.meta.glob("./**/*.ts");

let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  dns.address = "140.82.112.3";
});

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  return { t, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
}

const skillMd = (name: string, description: string, body = "Do the thing.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

// A fake GitHub repo at `ref`: the recursive tree listing plus each file's raw text.
function repo(ref: string, files: Record<string, string>, owner = "anthropics/skills"): Record<string, Recorded> {
  const tree = Object.keys(files).map((path) => ({ path, type: "blob" }));
  const fixtures: Record<string, Recorded> = {
    [`GET https://api.github.com/repos/${owner}/git/trees/${ref}?recursive=1`]: { body: { tree, truncated: false } },
  };
  for (const [path, text] of Object.entries(files))
    fixtures[`GET https://raw.githubusercontent.com/${owner}/${ref}/${path}`] = { body: text };
  return fixtures;
}

const pdf = {
  "README.md": "# Skills\n",
  "skills/pdf/SKILL.md": skillMd("pdf", "Work with PDF files."),
  "skills/pdf/reference.md": "PDF reference\n",
  "skills/docx/SKILL.md": skillMd("docx", "Work with Word files."),
};

describe("adding a skill from GitHub", () => {
  test("a folder URL adds the skill with its files and stores the normalized URL as its source", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("main", pdf));
    const result = await owner.action(api.skillActions.addFromGithub, {
      url: " https://github.com/anthropics/skills/tree/main/skills/pdf/ ",
    });
    expect(result).toMatchObject({ status: "added" });

    const [skill] = await owner.query(api.skills.list, {});
    expect(skill).toMatchObject({
      name: "pdf",
      description: "Work with PDF files.",
      source: { github: "https://github.com/anthropics/skills/tree/main/skills/pdf" },
    });
    expect((await owner.query(api.skills.get, { skillId: skill._id }))!.files).toEqual([
      { path: "reference.md", size: 14 },
    ]);
    // Only the pdf folder is downloaded.
    expect(fake.requests.map((r) => r.url).filter((u) => u.includes("docx"))).toEqual([]);
  });

  test("a SKILL.md URL resolves to its folder", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("main", pdf));
    await owner.action(api.skillActions.addFromGithub, {
      url: "https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md",
    });
    expect(await owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({ name: "pdf", source: { github: "https://github.com/anthropics/skills/tree/main/skills/pdf" } }),
    ]);
  });

  test("a repo root URL reads the default branch", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("HEAD", { "SKILL.md": skillMd("solo", "One skill per repo."), "notes.txt": "n" }, "someone/solo"));
    await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/someone/solo" });
    expect(await owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({ name: "solo", source: { github: "https://github.com/someone/solo" } }),
    ]);
  });

  test("a folder holding several skills fails with their folder paths", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("HEAD", pdf));
    expect(await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/anthropics/skills" })).toEqual({
      status: "invalid",
      reason: "There is no SKILL.md here, but these folders have one: skills/docx, skills/pdf.",
    });
    expect(await owner.query(api.skills.list, {})).toEqual([]);
  });

  test("a folder with no SKILL.md anywhere fails", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("main", pdf));
    expect(
      await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/anthropics/skills/tree/main/docs" }),
    ).toEqual({ status: "invalid", reason: "No SKILL.md found in docs." });
  });

  test("GitHub errors are shown in GitHub's words", async () => {
    const { owner } = await setup();
    const tree = "GET https://api.github.com/repos/someone/private/git/trees/HEAD?recursive=1";
    fake = fakeFetch({ [tree]: { status: 404, body: { message: "Not Found" } } });
    expect(await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/someone/private" })).toEqual({
      status: "invalid",
      reason: "GitHub said: Not Found",
    });
    fake.restore();
    fake = fakeFetch({
      [tree]: { status: 403, body: { message: "API rate limit exceeded for 1.2.3.4." } },
    });
    expect(await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/someone/private" })).toEqual({
      status: "invalid",
      reason: "GitHub said: API rate limit exceeded for 1.2.3.4.",
    });
  });

  test("a URL that isn't a GitHub repo is refused", async () => {
    const { owner } = await setup();
    fake = fakeFetch({});
    for (const url of ["https://gitlab.com/a/b", "github.com", "https://github.com/only-owner", "not a url"])
      expect(await owner.action(api.skillActions.addFromGithub, { url })).toMatchObject({ status: "invalid" });
    expect(fake.requests).toEqual([]);
  });

  test("every fetch goes through the URL guard", async () => {
    dns.address = "10.0.0.1"; // github.com resolving to a private address
    const { owner } = await setup();
    fake = fakeFetch(repo("main", pdf));
    expect(
      await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/anthropics/skills/tree/main/skills/pdf" }),
    ).toEqual({ status: "invalid", reason: expect.stringContaining("private address") });
    expect(fake.requests).toEqual([]);
  });

  test("validation and replace confirmation match uploads", async () => {
    const { owner } = await setup();
    fake = fakeFetch(repo("main", { "bad/SKILL.md": skillMd("Bad Name", "x") }));
    expect(
      await owner.action(api.skillActions.addFromGithub, { url: "https://github.com/anthropics/skills/tree/main/bad" }),
    ).toEqual({ status: "invalid", reason: 'The name "Bad Name" must be lowercase letters, digits and hyphens only.' });
    fake.restore();

    await owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd("pdf", "Old.") }] });
    fake = fakeFetch(repo("main", pdf));
    const url = "https://github.com/anthropics/skills/tree/main/skills/pdf";
    expect(await owner.action(api.skillActions.addFromGithub, { url })).toEqual({ status: "exists", name: "pdf" });
    expect(await owner.query(api.skills.list, {})).toEqual([expect.objectContaining({ description: "Old." })]);
    await owner.action(api.skillActions.addFromGithub, { url, replace: true });
    expect(await owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({ description: "Work with PDF files.", source: { github: url } }),
    ]);
  });
});

describe("refreshing a GitHub skill", () => {
  const url = "https://github.com/anthropics/skills/tree/main/skills/pdf";

  async function added() {
    const { owner } = await setup();
    fake = fakeFetch(repo("main", pdf));
    await owner.action(api.skillActions.addFromGithub, { url });
    await owner.mutation(api.skills.setOnForNewThreads, { skillId: (await owner.query(api.skills.list, {}))[0]._id, on: false });
    fake.restore();
    return { owner, skillId: (await owner.query(api.skills.list, {}))[0]._id };
  }

  test("refresh pulls the latest body and files, keeping the switch", async () => {
    const { owner, skillId } = await added();
    fake = fakeFetch(
      repo("main", {
        "skills/pdf/SKILL.md": skillMd("pdf", "Work with PDFs, better.", "New body.\n"),
        "skills/pdf/forms.md": "forms\n",
      }),
    );
    expect(await owner.action(api.skillActions.refresh, { skillId })).toEqual({ status: "added", skillId });
    expect(await owner.query(api.skills.get, { skillId })).toEqual({
      name: "pdf",
      description: "Work with PDFs, better.",
      body: "New body.\n",
      files: [{ path: "forms.md", size: 6 }],
    });
    expect((await owner.query(api.skills.list, {}))[0].onForNewThreads).toBe(false);
  });

  test("a refresh that changes the name is refused", async () => {
    const { owner, skillId } = await added();
    fake = fakeFetch(repo("main", { "skills/pdf/SKILL.md": skillMd("pdf-tools", "Renamed.") }));
    expect(await owner.action(api.skillActions.refresh, { skillId })).toEqual({
      status: "invalid",
      reason: 'The skill is now named "pdf-tools", not "pdf". Add it as a new skill instead.',
    });
    expect((await owner.query(api.skills.get, { skillId }))!.description).toBe("Work with PDF files.");
  });

  test("refresh passes GitHub errors through and changes nothing", async () => {
    const { owner, skillId } = await added();
    fake = fakeFetch({
      "GET https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1": {
        status: 404,
        body: { message: "Not Found" },
      },
    });
    expect(await owner.action(api.skillActions.refresh, { skillId })).toEqual({
      status: "invalid",
      reason: "GitHub said: Not Found",
    });
  });

  test("uploaded skills can't be refreshed", async () => {
    const { owner } = await setup();
    const result = await owner.mutation(api.skills.addFromFiles, {
      files: [{ path: "SKILL.md", text: skillMd("local", "Local.") }],
    });
    if (result.status !== "added") throw new Error();
    await expect(owner.action(api.skillActions.refresh, { skillId: result.skillId })).rejects.toThrow(
      "Only GitHub skills can be refreshed",
    );
  });
});
