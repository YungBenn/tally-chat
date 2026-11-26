/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { oaiDelta, oaiDone, oaiFinish } from "../test/sse";
import { api } from "./_generated/api";
import type { Effort } from "./lib/effort";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0,
      name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [
        { id: "o-reasoner", displayName: "Reasoner", hidden: false, reasoning: true },
        { id: "gpt-plain", displayName: "Plain", hidden: false },
      ],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  fake = fakeFetch({ [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 5, completion_tokens: 1 }) + oaiDone } });
  const reply = async (modelId: string, effort?: Effort) => {
    const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId, effort });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    return threadId;
  };
  // The latest reply request, not the title call (max_tokens 30) that follows it.
  const lastBody = () =>
    fake!.requests.map((r) => r.body as Record<string, unknown>).filter((b) => b.max_tokens !== 30).at(-1)!;
  return { t, owner, providerId, reply, lastBody };
}

describe("reasoning effort on OpenAI-compatible models", () => {
  test("a flagged model starts at low and sends reasoning_effort", async () => {
    const s = await setup();
    const thread = await s.reply("o-reasoner");
    expect(s.lastBody().reasoning_effort).toBe("low");
    expect((await s.owner.query(api.inspector.get, { threadId: thread }))!.effort).toBe("low");
  });

  test("xhigh and max are sent as high, other levels as chosen", async () => {
    const s = await setup();
    const sent: unknown[] = [];
    for (const effort of ["medium", "high", "xhigh", "max"] as const) {
      await s.reply("o-reasoner", effort);
      sent.push(s.lastBody().reasoning_effort);
    }
    expect(sent).toEqual(["medium", "high", "high", "high"]);
  });

  test("the thread's level can change, and the next request carries it", async () => {
    const s = await setup();
    const thread = await s.reply("o-reasoner");
    await s.owner.mutation(api.chat.setThreadEffort, { threadId: thread, effort: "max" });
    await s.owner.mutation(api.chat.send, { threadId: thread, content: "Again" });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.lastBody().reasoning_effort).toBe("high");
  });

  test("an unflagged model sends no effort field and offers no effort", async () => {
    const s = await setup();
    const thread = await s.reply("gpt-plain", "max");
    expect(JSON.stringify(s.lastBody())).not.toContain("effort");
    expect((await s.owner.query(api.inspector.get, { threadId: thread }))!.effort).toBeNull();
    await expect(s.owner.mutation(api.chat.setThreadEffort, { threadId: thread, effort: "low" })).rejects.toThrow();
  });

  test("the owner's toggle saves and shows in the provider list", async () => {
    const s = await setup();
    await s.owner.mutation(api.providers.updateModel, { providerId: s.providerId, modelId: "gpt-plain", reasoning: true });
    const models = (await s.owner.query(api.providers.list, {}))[0].models;
    expect(models.map((m) => [m.id, m.reasoning])).toEqual([["o-reasoner", true], ["gpt-plain", true]]);
    await s.owner.mutation(api.providers.updateModel, { providerId: s.providerId, modelId: "gpt-plain", reasoning: false });
    expect((await s.owner.query(api.providers.list, {}))[0].models[1].reasoning).toBe(false);
  });
});
