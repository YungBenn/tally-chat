/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta, toolUse, toolUseStop } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

const skillMd = (name: string, description: string, body = "Do the thing.\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
const PDF = skillMd("pdf", "Fill PDF forms.");
const PDF_URL = "https://github.com/anthropics/skills/tree/main/skills/pdf";
// A fake GitHub holding one skill folder, skills/pdf, whose SKILL.md is githubPdf.
let githubPdf = PDF;
beforeEach(() => void (githubPdf = PDF));
const GITHUB: Record<string, Recorded> = {
  "GET https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1": { body: { tree: [{ path: "skills/pdf/SKILL.md", type: "blob" }], truncated: false } },
  "GET https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md": { respond: () => new Response(githubPdf) },
};
const addSkillCall = (source: string): Step => ({ calls: [{ id: "toolu_1", name: "add_skill", args: { source } }] });

async function setup(steps: Step[] = [], { tools = true } = {}) {
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
  let n = 0;
  fake = fakeFetch({
    ...GITHUB,
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
  const newThread = () => owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const send = async (threadId: Id<"threads">) => {
    await owner.mutation(api.chat.send, { threadId, content: "Add this skill" });
    await settle();
  };
  const replyRequests = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const reply = async (threadId: Id<"threads">) => (await owner.query(api.chat.getThread, { threadId }))!.messages.at(-1)!;
  const toolResult = (body: Body) => (body.messages.at(-1)!.content as Block[])[0];
  return { t, owner, settle, newThread, send, replyRequests, reply, toolResult };
}

describe("the add_skill owner setting", () => {
  test("new threads carry add_skill by default; switched off, they don't; a model without tools never does", async () => {
    const s = await setup();
    expect((await s.owner.query(api.settings.get, {})).addSkillOnForNewThreads).toBe(true);
    await s.send(await s.newThread());
    expect(s.replyRequests()[0].tools!.map((x) => x.name)).toEqual(["add_skill"]);
    expect(s.replyRequests()[0].tools![0].input_schema).toMatchObject({ required: ["source"] });

    await s.owner.mutation(api.settings.setAddSkillOnForNewThreads, { on: false });
    expect((await s.owner.query(api.settings.get, {})).addSkillOnForNewThreads).toBe(false);
    const off = await s.newThread();
    await expect(s.owner.mutation(api.chat.send, { threadId: off, content: "Hi", tools: [{ builtin: "add_skill" }] })).rejects.toThrow("no longer offered");
    await s.send(off);
    expect(s.replyRequests()[1].tools).toBeUndefined();

    const toolless = await setup([], { tools: false });
    await toolless.send(await toolless.newThread());
    expect(toolless.replyRequests()[0].tools).toBeUndefined();
  });
});

describe("adding a skill through chat", () => {
  test("a GitHub URL is resolved before asking; approving saves it for the next thread, not this one", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Added." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    expect(waiting.status).toBe("waiting");
    expect(waiting.items).toEqual([
      expect.objectContaining({
        kind: "tool", tool: "add_skill", status: "waiting", alwaysAllowed: false,
        preview: { name: "pdf", description: "Fill PDF forms.", size: PDF.length, source: { github: PDF_URL }, hash: expect.stringMatching(/^[0-9a-f]{64}$/), replaces: false },
      }),
    ]);
    expect(await s.owner.query(api.skills.list, {})).toEqual([]);

    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    expect(s.toolResult(s.replyRequests()[1])).toEqual({
      type: "tool_result", tool_use_id: "toolu_1", content: "Added the skill pdf. It is available from the next thread, not this one.",
    });
    expect((await s.reply(threadId)).status).toBe("done");
    expect(await s.owner.query(api.skills.list, {})).toEqual([
      expect.objectContaining({ name: "pdf", description: "Fill PDF forms.", source: { github: PDF_URL }, onForNewThreads: true }),
    ]);

    await s.send(threadId);
    expect(s.replyRequests()[2].tools!.map((x) => x.name)).toEqual(["add_skill"]);
    await s.send(await s.newThread());
    expect(s.replyRequests()[3].tools!.map((x) => x.name)).toEqual(["read_skill", "add_skill"]);
    expect(s.replyRequests()[3].tools![0].description).toContain("- pdf: Fill PDF forms.");
  });

  test("pasted SKILL.md text says it replaces a same-named skill, and approving replaces it", async () => {
    const pasted = skillMd("pdf", "Fill PDF forms, better.", "New steps.\n");
    const s = await setup([addSkillCall(`\n${pasted}`), { text: "Added." }]);
    await s.owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: PDF }] });
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    expect(waiting.items![0]).toMatchObject({
      status: "waiting",
      preview: { name: "pdf", description: "Fill PDF forms, better.", size: pasted.length, source: "upload", replaces: true },
    });
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    const skills = await s.owner.query(api.skills.list, {});
    expect(skills).toEqual([expect.objectContaining({ name: "pdf", description: "Fill PDF forms, better.", source: "upload" })]);
    expect((await s.owner.query(api.skills.get, { skillId: skills[0]._id }))!.body).toBe("New steps.\n");
  });

  test("declining tells the model and adds nothing", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Okay." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: ["toolu_1"] });
    await s.settle();
    expect(s.toolResult(s.replyRequests()[1])).toMatchObject({ content: "The user declined this call.", is_error: true });
    expect((await s.reply(threadId)).status).toBe("done");
    expect(await s.owner.query(api.skills.list, {})).toEqual([]);
  });

  test("a source that can't be resolved finishes the call with the error, without asking", async () => {
    const s = await setup([addSkillCall("https://example.com/skill"), addSkillCall("---\nname: Bad Name\ndescription: x\n---\n"), { text: "Sorry." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const done = await s.reply(threadId);
    expect(done.status).toBe("done");
    expect(done.items!.filter((i) => i.kind === "tool").map((i) => i.kind === "tool" && i.status)).toEqual(["error", "error"]);
    const [, second, third] = s.replyRequests();
    expect(s.toolResult(second)).toMatchObject({ content: "Error: Enter a GitHub URL to a repo, a folder or a SKILL.md file.", is_error: true });
    expect(s.toolResult(third)).toMatchObject({ is_error: true });
    expect(String(s.toolResult(third).content)).toMatch(/^Error: .*name/);
    expect(await s.owner.query(api.skills.list, {})).toEqual([]);
  });

  test("a skill that changed on GitHub after the preview is not added", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Okay." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    githubPdf = skillMd("pdf", "Something else.");
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    expect(String(s.toolResult(s.replyRequests()[1]).content)).toMatch(/^Error: the skill changed after it was shown/);
    expect(await s.owner.query(api.skills.list, {})).toEqual([]);
  });

  test("a skill whose body changed on GitHub at the same size is not added", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Okay." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    githubPdf = skillMd("pdf", "Fill PDF forms.", "Do the THING.\n");
    expect(githubPdf.length).toBe(PDF.length);
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    expect(String(s.toolResult(s.replyRequests()[1]).content)).toMatch(/^Error: the skill changed after it was shown/);
    expect(await s.owner.query(api.skills.list, {})).toEqual([]);
  });

  test("a same-named skill added after a preview that said it doesn't replace is not overwritten", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Okay." }]);
    const threadId = await s.newThread();
    await s.send(threadId);
    const waiting = await s.reply(threadId);
    expect(waiting.items![0]).toMatchObject({ preview: { replaces: false } });
    const mine = skillMd("pdf", "My own PDF skill.");
    await s.owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: mine }] });
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    expect(String(s.toolResult(s.replyRequests()[1]).content)).toMatch(/^Error: a skill named pdf was added after/);
    expect(await s.owner.query(api.skills.list, {})).toEqual([expect.objectContaining({ name: "pdf", description: "My own PDF skill." })]);
  });

  test("always asks, even next to a tool server tool called add_skill that is always allowed", async () => {
    const s = await setup([addSkillCall(PDF_URL), { text: "Added." }]);
    await s.t.run(async (ctx) => {
      const ownerId = (await ctx.db.query("users").first())!._id;
      await ctx.db.insert("toolServers", {
        ownerId, name: "Skills", slug: "skills", url: "https://skills.example.com/mcp", headerNames: [], onForNewThreads: true,
        tools: [{ name: "add_skill", inputSchema: JSON.stringify({ type: "object" }) }], alwaysAllowed: ["add_skill"],
      });
    });
    const threadId = await s.newThread();
    await s.send(threadId);
    expect(s.replyRequests()[0].tools!.map((x) => x.name)).toEqual(["add_skill", "skills__add_skill"]);
    const waiting = await s.reply(threadId);
    expect(waiting.status).toBe("waiting");
    expect(waiting.items![0]).toMatchObject({ tool: "add_skill", status: "waiting", alwaysAllowed: false });
  });
});
