/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta, toolUse, toolUseStop } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Block = { type: string; [k: string]: unknown };
type Body = { max_tokens: number; messages: { role: string; content: string | Block[] }[]; tools?: { name: string; description?: string; input_schema: unknown }[] };
type Step = { text?: string; calls?: { id: string; name: string; args: object }[] };

const PREAMBLE =
  "Skills are instructions for specific tasks. Before doing a task that matches a skill below, " +
  "call this tool with the skill's name and follow what it returns. " +
  "A skill may refer to its other files: read one by passing its path.\n\nSkills:\n";
const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "The skill's name, from the list" },
    path: { type: "string", description: "A file of the skill to read instead of its instructions" },
  },
  required: ["name"],
};
const skillMd = (name: string, description: string, body = "Do the thing.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

async function setup(steps: Step[] = [], { tools = true, github = {} as Record<string, Recorded> } = {}) {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false, ...(tools ? {} : { tools: false }) }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  await owner.mutation(api.settings.setAddSkillOnForNewThreads, { on: false }); // these tests are about other tools
  let n = 0;
  fake = fakeFetch({
    ...github,
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (body.max_tokens === 30) return new Response(sse(messageStart({ input_tokens: 1 }), textDelta("Title"), messageDelta({ output_tokens: 1 }), messageStop));
        const step = steps[n++] ?? { text: "done" };
        const events = [messageStart({ input_tokens: 100 })];
        if (step.text) events.push(textDelta(step.text));
        step.calls?.forEach((c, i) => events.push(toolUse(i, c.id, c.name, JSON.stringify(c.args))));
        events.push(step.calls ? toolUseStop({ output_tokens: 10 }) : messageDelta({ output_tokens: 10 }), messageStop);
        return new Response(sse(...events));
      },
    },
  });
  const settle = () => t.finishAllScheduledFunctions(() => {});
  const addSkill = (name: string, description: string, body?: string, files: { path: string; text: string }[] = []) =>
    owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: skillMd(name, description, body) }, ...files], replace: true });
  const newThread = () => owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const send = async (threadId: Awaited<ReturnType<typeof newThread>>, tools?: { builtin: string; skills?: string[] }[]) => {
    await owner.mutation(api.chat.send, { threadId, content: "Hi", tools });
    await settle();
  };
  const replyRequests = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const replies = () => t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.role === "assistant"));
  return { t, owner, settle, addSkill, newThread, send, replyRequests, replies };
}

describe("read_skill freezes the skill catalog", () => {
  test("a new thread's first request carries read_skill with the catalog of skills on for new threads, sorted by name", async () => {
    const s = await setup();
    await s.addSkill("zeta", "Last one.");
    await s.addSkill("alpha", "Write in the house style.");
    await s.addSkill("off", "Not on.");
    const [off] = (await s.owner.query(api.skills.list, {})).filter((k) => k.name === "off");
    await s.owner.mutation(api.skills.setOnForNewThreads, { skillId: off._id, on: false });
    const threadId = await s.newThread();
    await s.send(threadId);
    expect(s.replyRequests()[0].tools).toEqual([
      { name: "read_skill", description: `${PREAMBLE}- alpha: Write in the house style.\n- zeta: Last one.`, input_schema: SCHEMA },
    ]);
    expect((await s.owner.query(api.chat.threadTools, { threadId }))!.picks).toEqual([{ builtin: "read_skill", skills: ["alpha", "zeta"] }]);
    const view = (await s.owner.query(api.inspector.get, { threadId }))!;
    const description = `${PREAMBLE}- alpha: Write in the house style.\n- zeta: Last one.`;
    expect(view.layers.find((l) => l.kind === "tools")!.tokens).toBe(
      Math.ceil(JSON.stringify([{ name: "read_skill", description, inputSchema: JSON.stringify(SCHEMA) }]).length / 4),
    );
  });

  test("adding, toggling, replacing or deleting skills afterwards leaves the thread's later requests byte-identical; retries too", async () => {
    const s = await setup();
    await s.addSkill("alpha", "First.");
    await s.addSkill("beta", "Second.");
    const threadId = await s.newThread();
    await s.send(threadId);
    await s.addSkill("gamma", "New.");
    await s.addSkill("alpha", "Replaced.", "New body.\n");
    const skills = await s.owner.query(api.skills.list, {});
    await s.owner.mutation(api.skills.setOnForNewThreads, { skillId: skills.find((k) => k.name === "gamma")!._id, on: false });
    await s.owner.mutation(api.skills.remove, { skillId: skills.find((k) => k.name === "beta")!._id });
    await s.send(threadId);
    const [reply] = await s.replies();
    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.settle();
    const [first, ...later] = s.replyRequests();
    expect(later).toHaveLength(2);
    for (const body of later) expect(JSON.stringify(body.tools)).toBe(JSON.stringify(first.tools));
    expect(first.tools![0].description).toBe(`${PREAMBLE}- alpha: First.\n- beta: Second.`);
  });

  test("no read_skill when no skill is on, or when the model can't call tools", async () => {
    const none = await setup();
    await none.send(await none.newThread());
    expect(none.replyRequests()[0].tools).toBeUndefined();

    const toolless = await setup([], { tools: false });
    await toolless.addSkill("alpha", "First.");
    await toolless.send(await toolless.newThread());
    expect(toolless.replyRequests()[0].tools).toBeUndefined();
  });

  test("only the first 100 skills by name enter the catalog", async () => {
    const s = await setup();
    for (let i = 0; i < 101; i++) await s.addSkill(`s${String(i).padStart(3, "0")}`, "x");
    const threadId = await s.newThread();
    await s.send(threadId);
    const description = s.replyRequests()[0].tools![0].description!;
    expect(description).toContain("- s099: x");
    expect(description).not.toContain("s100");
  });

  test("skills left out in the picker before the first send shrink the catalog", async () => {
    const s = await setup();
    await s.addSkill("alpha", "First.");
    await s.addSkill("beta", "Second.");
    await s.send(await s.newThread(), [{ builtin: "read_skill", skills: ["beta"] }]);
    expect(s.replyRequests()[0].tools![0].description).toBe(`${PREAMBLE}- beta: Second.`);
  });

  test("an existing thread's skills change through the set-thread-tools path", async () => {
    const s = await setup();
    await s.addSkill("alpha", "First.");
    await s.addSkill("beta", "Second.");
    const threadId = await s.newThread();
    await s.send(threadId, [{ builtin: "read_skill", skills: ["alpha"] }]);
    await s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [{ builtin: "read_skill", skills: ["alpha", "beta"] }] });
    await s.send(threadId);
    expect(s.replyRequests()[1].tools![0].description).toBe(`${PREAMBLE}- alpha: First.\n- beta: Second.`);
  });
});

describe("the model reads a skill", () => {
  const files = [{ path: "refs/checklist.md", text: "- one\n- two\n" }];
  const resultOf = (body: Body) => (body.messages.at(-1)!.content as Block[])[0];

  test("no path returns the body, a path returns that file, without asking for approval; results go back verbatim", async () => {
    const s = await setup([
      { calls: [{ id: "toolu_1", name: "read_skill", args: { name: "review" } }] },
      { calls: [{ id: "toolu_2", name: "read_skill", args: { name: "review", path: "refs/checklist.md" } }] },
      { text: "Done." },
    ]);
    await s.addSkill("review", "A review checklist.", "# Review\nCheck it.\n", files);
    const threadId = await s.newThread();
    await s.send(threadId);
    const [reply] = await s.replies();
    expect(reply.status).toBe("done");
    const [, second, third] = s.replyRequests();
    expect(resultOf(second)).toEqual({ type: "tool_result", tool_use_id: "toolu_1", content: "# Review\nCheck it.\n" });
    expect(resultOf(third)).toEqual({ type: "tool_result", tool_use_id: "toolu_2", content: "- one\n- two\n" });
    // The next turn sends both results again, byte for byte.
    await s.send(threadId);
    const next = JSON.stringify(s.replyRequests()[3].messages);
    expect(next).toContain(JSON.stringify("# Review\nCheck it.\n"));
    expect(next).toContain(JSON.stringify("- one\n- two\n"));
  });

  test("errors: a name outside the catalog lists it, a deleted skill was removed, a missing path lists the files", async () => {
    const s = await setup([
      { calls: [
        { id: "toolu_1", name: "read_skill", args: { name: "nope" } },
        { id: "toolu_2", name: "read_skill", args: { name: "review", path: "missing.md" } },
        { id: "toolu_3", name: "read_skill", args: { name: "gone" } },
      ] },
      { text: "Done." },
    ]);
    await s.addSkill("review", "A review checklist.", undefined, files);
    await s.addSkill("gone", "Soon deleted.");
    const threadId = await s.newThread();
    // Frozen, then deleted before the model reads it.
    await s.owner.mutation(api.chat.send, { threadId, content: "Hi" });
    const gone = (await s.owner.query(api.skills.list, {})).find((k) => k.name === "gone")!;
    await s.owner.mutation(api.skills.remove, { skillId: gone._id });
    await s.settle();
    const results = s.replyRequests()[1].messages.at(-1)!.content as Block[];
    expect(results.map((r) => r.content)).toEqual([
      "Error: there is no skill called nope in this thread. Skills: gone, review",
      "Error: review has no file missing.md. Files: SKILL.md, refs/checklist.md",
      "Error: this skill was removed",
    ]);
  });

  test("refreshing a GitHub skill keeps the thread's catalog bytes; later reads get the new body", async () => {
    let skillText = skillMd("pdf", "Work with PDF files.", "Old body.\n");
    const s = await setup(
      [
        { calls: [{ id: "toolu_1", name: "read_skill", args: { name: "pdf" } }] },
        { text: "Done." },
        { calls: [{ id: "toolu_2", name: "read_skill", args: { name: "pdf" } }] },
        { text: "Done again." },
      ],
      {
        github: {
          "GET https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1": { body: { tree: [{ path: "skills/pdf/SKILL.md", type: "blob" }], truncated: false } },
          "GET https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md": { respond: () => new Response(skillText) },
        },
      },
    );
    await s.owner.action(api.skillActions.addFromGithub, { url: "https://github.com/anthropics/skills/tree/main/skills/pdf" });
    const threadId = await s.newThread();
    await s.send(threadId);
    skillText = skillMd("pdf", "Now about every document.", "New body.\n");
    const [skill] = await s.owner.query(api.skills.list, {});
    await s.owner.action(api.skillActions.refresh, { skillId: skill._id });
    await s.send(threadId);
    const requests = s.replyRequests();
    expect(requests).toHaveLength(4);
    for (const body of requests) expect(JSON.stringify(body.tools)).toBe(JSON.stringify(requests[0].tools));
    expect(requests[0].tools![0].description).toBe(`${PREAMBLE}- pdf: Work with PDF files.`);
    const last = requests[3].messages;
    expect(JSON.stringify(last)).toContain(JSON.stringify("Old body.\n"));
    expect(resultOf(requests[3])).toEqual({ type: "tool_result", tool_use_id: "toolu_2", content: "New body.\n" });
  });

  test("a large file is capped like any tool result", async () => {
    const s = await setup([{ calls: [{ id: "toolu_1", name: "read_skill", args: { name: "big" } }] }, { text: "Done." }]);
    await s.addSkill("big", "Big.", "a".repeat(40_000));
    await s.send(await s.newThread());
    expect(resultOf(s.replyRequests()[1]).content).toBe(`${"a".repeat(32_000)}\n[result truncated at ~8k tokens]`);
  });
});
