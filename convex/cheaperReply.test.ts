/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import { threadState } from "./threadState";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { model: string; max_tokens?: number; output_config?: { effort: string }; messages: { role: string; content: unknown }[]; tools?: { name: string; description?: string }[] };
const CACHING = { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000, output_tokens: 1 };

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-opus-5-5", displayName: "Opus", hidden: false },
        { id: "claude-haiku-5-5", displayName: "Haiku", hidden: false },
        { id: "claude-hidden", displayName: "Hidden", hidden: true },
      ],
    }),
  );
  const openaiId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false }, { id: "mystery", displayName: "Mystery", hidden: false }],
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "Local", apiStyle: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", free: true,
      models: [{ id: "llama3", displayName: "Llama", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  await owner.mutation(api.settings.setAddSkillOnForNewThreads, { on: false }); // these tests are about other tools
  fake = fakeFetch({
    [ANTHROPIC]: { respond: () => new Response(sse(messageStart(CACHING), textDelta("ok"), messageDelta({ output_tokens: 1 }), messageStop)) },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 5, completion_tokens: 1 }) + oaiDone },
  });
  const threadId = await owner.mutation(api.chat.createThread, { providerId: anthropicId, modelId: "claude-opus-5-5", effort: "high" });
  await owner.mutation(api.chat.markActive, { threadId });
  const send = async (content: string, model?: { providerId: Id<"providers">; modelId: string }) => {
    await owner.mutation(api.chat.send, { threadId, content, model });
    await t.finishAllScheduledFunctions(() => {});
  };
  const replies = () => fake!.requests.filter((r) => (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const thread = () => t.run((ctx) => ctx.db.get("threads", threadId));
  const state = () => t.run((ctx) => threadState(ctx, threadId));
  return { t, owner, ownerId, anthropicId, openaiId, threadId, send, replies, thread, state };
}

describe("reply with another model, once", () => {
  test("goes to that model with the thread's history, leaves the thread's model and cache alone", async () => {
    const s = await setup();
    await s.send("First");
    const before = (await s.state())!;
    expect(before.cacheTouchedAt).toBeDefined();

    await s.send("Quick one", { providerId: s.openaiId, modelId: "gpt-5" });
    const oai = fake!.requests.find((r) => r.url === "https://api.openai.com/v1/chat/completions")!.body as Body;
    expect(oai.model).toBe("gpt-5");
    expect(oai.messages.map((m) => m.content)).toEqual(expect.arrayContaining(["First", "ok", "Quick one"]));
    expect(JSON.stringify(oai)).not.toContain("effort"); // no effort outside Anthropic style

    const after = (await s.thread())!;
    expect(after.modelId).toBe("claude-opus-5-5");
    const afterState = (await s.state())!;
    expect(afterState.cacheTouchedAt).toBe(before.cacheTouchedAt);
    expect(afterState.keepaliveJobId).toBe(before.keepaliveJobId);

    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!;
    const reply = view.messages.at(-1)!;
    expect([reply.model, reply.modelName, reply.effort]).toEqual(["gpt-5", "GPT-5", undefined]);
    // Metered under the model that produced it.
    const byModel = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(byModel.filter((r) => r.dimension === "model").map((r) => r.key).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "gpt-5"]); // Haiku: the title side job
    expect(byModel.find((r) => r.dimension === "provider" && r.key === s.openaiId)?.calls).toBe(1);
    // The inspector's cache read still comes from the thread's own model.
    expect((await s.owner.query(api.inspector.get, { threadId: s.threadId }))!.cache.lastReadTokens).toBe(0);

    await s.send("Back to normal");
    expect(s.replies().at(-1)!.model).toBe("claude-opus-5-5");
    expect((await s.state())?.cacheTouchedAt).toBeGreaterThan(before.cacheTouchedAt!);
  });

  test("an Anthropic-style override gets the effort in force; per-message effort can't ride along", async () => {
    const s = await setup();
    await s.send("First", { providerId: s.anthropicId, modelId: "claude-haiku-5-5" });
    const body = s.replies().at(-1)!;
    expect([body.model, body.output_config]).toEqual(["claude-haiku-5-5", { effort: "high" }]);
    expect((await s.state())?.cacheTouchedAt).toBeUndefined(); // the cache it wrote is Haiku's

    await expect(
      s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "x", effort: "low", model: { providerId: s.openaiId, modelId: "gpt-5" } }),
    ).rejects.toThrow("Change effort on a reply from the thread's own model");
    await expect(s.send("x", { providerId: s.anthropicId, modelId: "claude-hidden" })).rejects.toThrow("Model not available");
  });

  // Skills story 40: a skill added or replaced mid-thread doesn't reach the cheaper reply.
  test("sends the thread's frozen read_skill catalog after skills change mid-thread", async () => {
    const s = await setup();
    const addSkill = (name: string, description: string) =>
      s.owner.mutation(api.skills.addFromFiles, { files: [{ path: "SKILL.md", text: `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n` }], replace: true });
    await addSkill("alpha", "First.");
    await s.send("First");
    await addSkill("alpha", "Replaced.");
    await addSkill("beta", "New.");
    await s.send("Quick one", { providerId: s.anthropicId, modelId: "claude-haiku-5-5" });
    const [first, cheaper] = s.replies().filter((b) => b.tools);
    expect(cheaper.model).toBe("claude-haiku-5-5");
    expect(first.tools![0].description).toMatch(/- alpha: First\.$/);
    expect(JSON.stringify(cheaper.tools)).toBe(JSON.stringify(first.tools));
  });

  test("retry with another model becomes a new version of that reply", async () => {
    const s = await setup();
    await s.send("First");
    const first = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    await s.owner.mutation(api.chat.retry, { messageId: first._id, model: { providerId: s.openaiId, modelId: "gpt-5" } });
    await s.t.finishAllScheduledFunctions(() => {});
    const retried = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    expect(retried.model).toBe("gpt-5");
    expect(retried.siblingIds).toEqual([first._id, retried._id]);
    await s.owner.mutation(api.chat.switchBranch, { messageId: first._id });
    expect((await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!.model).toBe("claude-opus-5-5");
  });
});

describe("per-model cost estimates", () => {
  test("the thread's model at its cache state, others cold, free at $0, unpriced last", async () => {
    const s = await setup();
    await s.send("First");
    const info = (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!;
    const prefix = info.next.prefixTokens;
    const out = info.next.expectedOutputTokens!;
    const touched = (await s.state())!.cacheTouchedAt!;
    const estimate = (now: number) =>
      s.owner.query(api.inspector.modelEstimates, { threadId: s.threadId, now, draftTokens: 10, maxOutputTokens: 4000 });
    const micro = (prefixPrice: number, input: number, output: number) =>
      Math.round((prefix * prefixPrice + 10 * input + out * output) * 1e6);

    const warm = await estimate(touched + 1000);
    const cost = (id: string) => warm.find((r) => r.modelId === id)!.costMicroUsd;
    expect(cost("claude-opus-5-5")).toBe(micro(2e-7, 4e-6, 2e-5)); // cache read
    expect(cost("claude-haiku-5-5")).toBe(micro(1.25e-7, 1e-7, 5e-7)); // cold: cache write
    expect(cost("gpt-5")).toBe(micro(1.25e-6, 1.25e-6, 1e-5)); // cold: input
    expect(cost("llama3")).toBe(0);
    expect(cost("mystery")).toBeNull();
    expect(warm.map((r) => r.modelId)).toEqual(["llama3", "claude-haiku-5-5", "claude-opus-5-5", "gpt-5", "mystery"]);
    expect(warm.filter((r) => r.thread).map((r) => r.modelId)).toEqual(["claude-opus-5-5"]);

    // Once the cache has expired, the thread's own model pays the cache write too.
    const cold = await estimate(touched + 60 * 60_000);
    expect(cold.find((r) => r.thread)!.costMicroUsd).toBe(micro(5e-6, 4e-6, 2e-5));
  });

  // With keepalive off, the second turn asks for the 1-hour lifetime while the first turn's
  // request (the stored state) asked for 5 minutes: cache writes are priced at the next send's.
  test("cache writes are priced at the lifetime the next send asks for", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setKeepaliveEnabled, { enabled: false });
    await s.send("First");
    expect((await s.state())!.cacheTtl).toBe("5m");
    const info = (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!;
    const prefix = info.next.prefixTokens;
    const out = info.next.expectedOutputTokens!;
    const micro = (prefixPrice: number, input: number, output: number) =>
      Math.round((prefix * prefixPrice + 10 * input + out * output) * 1e6);
    const rows = await s.owner.query(api.inspector.modelEstimates, {
      threadId: s.threadId, now: (await s.state())!.cacheTouchedAt! + 60 * 60_000, draftTokens: 10, maxOutputTokens: 4000,
    });
    const cost = (id: string) => rows.find((r) => r.modelId === id)!.costMicroUsd;
    expect(cost("claude-opus-5-5")).toBe(micro(8e-6, 4e-6, 2e-5)); // the thread's, cold: 1-hour write
    expect(cost("claude-haiku-5-5")).toBe(micro(2e-7, 1e-7, 5e-7)); // another model: 1-hour write
  });

  test("a retry prices the reply's question as the new message", async () => {
    const s = await setup();
    await s.send("First");
    await s.send("Second question here");
    const reply = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    const rows = await s.owner.query(api.inspector.modelEstimates, {
      threadId: s.threadId, now: 0, draftTokens: 999, maxOutputTokens: 4000, retryOf: reply._id,
    });
    const send = await s.owner.query(api.inspector.modelEstimates, { threadId: s.threadId, now: 0, draftTokens: 999, maxOutputTokens: 4000 });
    const haiku = (r: typeof rows) => r.find((x) => x.modelId === "claude-haiku-5-5")!.costMicroUsd!;
    expect(haiku(rows)).toBeLessThan(haiku(send)); // shorter prefix, and the 999-token draft is ignored
  });
});
