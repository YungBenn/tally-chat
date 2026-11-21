/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

test("a reply is one step: its usage and cost are that step's", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const providerId = await t.run(async (ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted: await encryptSecret("sk"), detected: "", keyCheckedAt: 0,
      name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  fake = fakeFetch({
    "POST https://api.anthropic.com/v1/messages": {
      body: sse(messageStart({ input_tokens: 10, cache_read_input_tokens: 0 }), textDelta("ok"), messageDelta({ output_tokens: 2 }), messageStop),
    },
  });
  await owner.mutation(api.chat.send, { threadId, content: "Hi" });
  await t.finishAllScheduledFunctions(() => {});
  const reply = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((m) => m.role === "assistant")!);
  expect(reply.status).toBe("done");
  expect(reply.steps).toHaveLength(1);
  expect(reply.steps![0].usage).toEqual(reply.usage);
  expect(reply.steps![0].costMicroUsd).toBe(reply.costMicroUsd);
  expect(reply.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
});

test("a reply whose thread is deleted before it starts still logs its timing line and closes", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const providerId = await t.run(async (ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted: await encryptSecret("sk"), detected: "", keyCheckedAt: 0,
      name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  await owner.mutation(api.chat.send, { threadId, content: "Hi" });
  await t.run((ctx) => ctx.db.delete("threads", threadId));
  const log = vi.spyOn(console, "log");
  await t.finishAllScheduledFunctions(() => {});
  const reply = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((m) => m.role === "assistant")!);
  expect(reply.status).toBe("stopped");
  const timing = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("reply step "));
  expect(timing).toEqual([expect.stringMatching(/^reply step \S+ status=stopped queue=- input=\d+ms firstEvent=- firstText=- total=\d+ms$/)]);
  log.mockRestore();
});
