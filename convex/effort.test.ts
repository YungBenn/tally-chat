/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { max_tokens?: number; stream?: boolean; output_config?: { effort: string }; thinking?: unknown; messages: unknown[] };
const CACHING = { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000, output_tokens: 1 };

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const openaiId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (!body.stream) return Response.json({ type: "message", content: [], usage: { input_tokens: 2, cache_read_input_tokens: 2000, output_tokens: 0 } });
        return new Response(sse(messageStart(CACHING), textDelta("ok"), messageDelta({ output_tokens: 1 }), messageStop));
      },
    },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 5, completion_tokens: 1 }) + oaiDone },
  });
  const chat = async (threadId: Id<"threads">, content = "Hi") => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const anthropicBodies = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages")).map((r) => r.body as Body);
  return { t, owner, anthropicId, openaiId, chat, anthropicBodies };
}

describe("per-model default effort", () => {
  const stored = async (s: Awaited<ReturnType<typeof setup>>, modelId: string) => {
    const providerId = await s.t.run(async (ctx) => {
      const p = (await ctx.db.get("providers", s.anthropicId))!;
      await ctx.db.patch("providers", s.anthropicId, { models: [...p.models, { id: modelId, displayName: modelId, hidden: false }] });
      return s.anthropicId;
    });
    const thread = await s.owner.mutation(api.chat.createThread, { providerId, modelId });
    await s.chat(thread);
    return s.anthropicBodies().filter((b) => b.max_tokens !== 512).at(-1)!.output_config;
  };

  test.each([
    ["claude-opus-5-5", "medium"],
    ["cc/claude-opus-5-5", "medium"],
    ["claude-fable-5-2", "medium"],
    ["claude-sonnet-5-5", "low"],
    ["claude-haiku-5-5", "low"],
    ["mystery-model", "low"],
  ])("new thread on %s sends %s", async (modelId, effort) => {
    const s = await setup();
    expect(await stored(s, modelId)).toEqual({ effort });
  });

  test("a saved default effort wins over the model default", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setDefaultEffort, { effort: "high" });
    expect(await stored(s, "claude-opus-5-5")).toEqual({ effort: "high" });
  });

  test("existing threads keep their stored effort when the model default changes", async () => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.anthropicId, modelId: "claude-sonnet-5-5" });
    await s.owner.mutation(api.settings.setDefaultEffort, { effort: "max" });
    await s.chat(thread);
    expect(s.anthropicBodies().find((b) => b.max_tokens !== 512)!.output_config).toEqual({ effort: "low" });
  });
});

describe("thread effort", () => {
  test("new Anthropic threads default to low, sent on every reply with no thinking parameter", async () => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.anthropicId, modelId: "claude-sonnet-5-5" });
    await s.chat(thread);
    await s.chat(thread, "Again");
    const replies = s.anthropicBodies().filter((b) => b.max_tokens !== 512);
    expect(replies.map((b) => b.output_config)).toEqual([{ effort: "low" }, { effort: "low" }]);
    expect(replies.every((b) => b.thinking === undefined)).toBe(true);
  });

  test("the chosen effort is fixed for the thread, recorded on each reply, and shown by the inspector", async () => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.anthropicId, modelId: "claude-sonnet-5-5", effort: "high" });
    await s.chat(thread);
    expect(s.anthropicBodies().find((b) => b.max_tokens !== 512)!.output_config).toEqual({ effort: "high" });
    const reply = (await s.owner.query(api.chat.getThread, { threadId: thread }))!.messages.at(-1)!;
    expect(reply.effort).toBe("high");
    expect((await s.owner.query(api.inspector.get, { threadId: thread }))!.effort).toBe("high");
    expect((await s.owner.query(api.inspector.turn, { messageId: reply._id }))!.effort).toBe("high");
  });

  test("keepalives send the thread's effort; titles send low", async () => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.anthropicId, modelId: "claude-sonnet-5-5", effort: "medium" });
    await s.owner.mutation(api.chat.markActive, { threadId: thread });
    await s.chat(thread);
    await s.t.action(internal.chatActions.keepalive, { threadId: thread });
    const keepalive = s.anthropicBodies().find((b) => b.stream === false)!;
    expect(keepalive.output_config).toEqual({ effort: "medium" });
    expect(s.anthropicBodies().find((b) => b.max_tokens === 512)!.output_config).toEqual({ effort: "low" });
  });

  test("Anthropic threads from before phase 4 run at low; OpenAI-compatible threads send no effort", async () => {
    const s = await setup();
    const old = await s.owner.mutation(api.chat.createThread, { providerId: s.anthropicId, modelId: "claude-sonnet-5-5" });
    await s.t.run((ctx) => ctx.db.patch("threads", old, { effort: undefined }));
    await s.chat(old);
    expect(s.anthropicBodies().find((b) => b.max_tokens !== 512)!.output_config).toEqual({ effort: "low" });

    const oai = await s.owner.mutation(api.chat.createThread, { providerId: s.openaiId, modelId: "gpt-5", effort: "max" });
    expect((await s.t.run((ctx) => ctx.db.get("threads", oai)))!.effort).toBeUndefined();
    await s.chat(oai);
    const body = fake!.requests.find((r) => r.url.endsWith("/chat/completions"))!.body as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("effort");
    expect((await s.owner.query(api.inspector.get, { threadId: oai }))!.effort).toBeNull();
  });
});
