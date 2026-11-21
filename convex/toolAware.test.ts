/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { fakeMcp } from "../test/fakeMcp";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta, toolUse, toolUseStop } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";
const MCP = "https://docs.example.com/mcp";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

const search = { name: "search", description: "Search", inputSchema: JSON.stringify({ type: "object" }) };

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
      models: [
        { id: "gpt-5", displayName: "GPT-5", hidden: false, tools: true },
        { id: "plain", displayName: "Plain", hidden: false },
      ],
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("toolServers", {
      ownerId, name: "Docs", slug: "docs", url: MCP, headerNames: [], onForNewThreads: true, tools: [search], alwaysAllowed: ["search"],
    }),
  );
  let n = 0;
  fake = fakeFetch({
    ...fakeMcp(MCP, { tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }], call: () => ({ content: [{ type: "text", text: "zebrafish habitat notes" }] }) }),
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as { max_tokens: number };
        if (body.max_tokens === 30) return new Response(sse(messageStart({ input_tokens: 1 }), textDelta("T"), messageDelta({ output_tokens: 1 }), messageStop));
        n += 1;
        return new Response(
          n === 1
            ? sse(messageStart({ input_tokens: 10, cache_read_input_tokens: 0 }), textDelta("Looking."), toolUse(1, "tu1", "docs__search", "{}"), toolUseStop({ output_tokens: 3 }), messageStop)
            : sse(messageStart({ input_tokens: 10, cache_read_input_tokens: 0 }), textDelta("The answer is pelican."), messageDelta({ output_tokens: 3 }), messageStop),
        );
      },
    },
    [OPENAI]: { body: oaiDelta("cheap reply") + oaiFinish({ prompt_tokens: 10, completion_tokens: 2 }) + oaiDone },
  });
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId: anthropicId, modelId: "claude-sonnet-5-5" });
  await owner.mutation(api.chat.send, { threadId, content: "Find it" });
  await t.finishAllScheduledFunctions(() => {});
  return { t, owner, ownerId, anthropicId, openaiId, threadId };
}

describe("a thread that uses tools", () => {
  test("the model lists flag which models can call tools", async () => {
    const s = await setup();
    const rows = await s.owner.query(api.inspector.modelEstimates, { threadId: s.threadId, now: Date.now(), draftTokens: 10, maxOutputTokens: 4000 });
    expect(Object.fromEntries(rows.map((r) => [r.modelId, r.tools]))).toEqual({ "claude-sonnet-5-5": true, "gpt-5": true, plain: false });
  });

  test("a send or retry on a model that can't call tools is refused; one that can runs on the thread's tools", async () => {
    const s = await setup();
    const reply = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1];
    await expect(s.owner.mutation(api.chat.retry, { messageId: reply._id, model: { providerId: s.openaiId, modelId: "plain" } })).rejects.toThrow("can't call the tools this thread uses");
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "More", model: { providerId: s.openaiId, modelId: "plain" } })).rejects.toThrow("can't call the tools");

    const touchedBefore = (await s.t.run((ctx) => ctx.db.get("threads", s.threadId)))!.cacheTouchedAt;
    await s.owner.mutation(api.chat.retry, { messageId: reply._id, model: { providerId: s.openaiId, modelId: "gpt-5" } });
    await s.t.finishAllScheduledFunctions(() => {});
    const wire = fake!.requests.findLast((r) => r.url.includes("chat/completions"))!.body as { tools: { function: { name: string } }[]; messages: { role: string }[] };
    expect(wire.tools.map((x) => x.function.name)).toEqual(["docs__search"]);
    expect((await s.t.run((ctx) => ctx.db.get("threads", s.threadId)))!.cacheTouchedAt).toBe(touchedBefore); // a one-off model never touches the thread's cache
  });

  test("a thread without tools sends to any model", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.setThreadTools, { threadId: s.threadId, tools: [] });
    const reply = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1];
    await s.owner.mutation(api.chat.retry, { messageId: reply._id, model: { providerId: s.openaiId, modelId: "plain" } });
    await s.t.finishAllScheduledFunctions(() => {});
    const wire = fake!.requests.findLast((r) => r.url.includes("chat/completions"))!.body as { tools?: unknown };
    expect(wire.tools).toBeUndefined();
  });

  test("search matches a reply's text but not text found only in its tool results", async () => {
    const s = await setup();
    const reply = (await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((m) => m.role === "assistant")))!;
    expect(reply.parts!.some((p) => p.type === "toolResult" && p.text.includes("zebrafish"))).toBe(true);
    expect((await s.owner.query(api.search.search, { query: "zebrafish" })).messages).toEqual([]);
    expect((await s.owner.query(api.search.search, { query: "pelican" })).messages).toHaveLength(1);
  });
});
