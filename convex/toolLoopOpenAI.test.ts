/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { fakeMcp } from "../test/fakeMcp";
import { oaiDelta, oaiDone, oaiFinish, oaiToolCall, oaiToolFinish } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const OPENAI = "POST https://api.openai.com/v1/chat/completions";
const MCP = "https://docs.example.com/mcp";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Wire = { max_tokens?: number; messages: { role: string; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string }[]; tools?: unknown[] };
type Step = { text?: string; calls?: { id: string; name: string; args: object }[] };

const search = { name: "search", description: "Search", inputSchema: JSON.stringify({ type: "object" }) };
const dangerous = { name: "delete", inputSchema: JSON.stringify({ type: "object" }) };
const asFake = (t: { name: string; description?: string; inputSchema: string }) => ({ ...t, inputSchema: JSON.parse(t.inputSchema) as object });
const call = (id: string, name: string, args: object = {}) => ({ id, name: `docs__${name}`, args });

async function setup(steps: Step[] | ((n: number) => Step), mcpOptions: Partial<Parameters<typeof fakeMcp>[1]> = {}) {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0, name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false, tools: true }],
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("toolServers", {
      ownerId, name: "Docs", slug: "docs", url: MCP, headerNames: [], onForNewThreads: true,
      tools: [search, dangerous], alwaysAllowed: ["search"],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "gpt-5" });
  let n = 0;
  const mcpCalls: { name: string; args: object }[] = [];
  fake = fakeFetch({
    ...fakeMcp(MCP, {
      tools: [asFake(search), asFake(dangerous)],
      call: (name, args) => {
        mcpCalls.push({ name, args });
        if (name === "search" && (args as { fail?: boolean }).fail) return { isError: true, content: [{ type: "text", text: "no such page" }] };
        return { content: [{ type: "text", text: `result of ${name}` }] };
      },
      ...mcpOptions,
    }),
    [OPENAI]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Wire;
        if (body.max_tokens === 30) return new Response(oaiDelta("Title") + oaiFinish({ prompt_tokens: 1, completion_tokens: 1 }) + oaiDone);
        n += 1;
        const step = typeof steps === "function" ? steps(n) : (steps[n - 1] ?? { text: "done" });
        const usage = { prompt_tokens: 100 * n, completion_tokens: 10 };
        const stream = step.calls
          ? (step.text ? oaiDelta(step.text) : "") +
            step.calls.map((c, i) => oaiToolCall(i, c.id, c.name, JSON.stringify(c.args))).join("") +
            oaiToolFinish(usage)
          : oaiDelta(step.text ?? "") + oaiFinish(usage);
        return new Response(stream + oaiDone);
      },
    },
  });
  const send = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const requests = () => fake!.requests.filter((r) => r.url.includes("chat/completions") && (r.body as Wire).max_tokens !== 30).map((r) => r.body as Wire);
  const replies = () => t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.role === "assistant"));
  return { t, owner, threadId, send, requests, replies, mcpCalls };
}

describe("the tool loop on OpenAI-compatible providers", () => {
  test("calls go back as tool_calls and tool-role messages; parallel, declined and failing calls all get results", async () => {
    const s = await setup([
      { text: "Looking.", calls: [call("c1", "search", { q: "a" }), call("c2", "delete"), call("c3", "search", { fail: true })] },
      { text: "Done." },
    ]);
    await s.send("Go");
    // c2 isn't always allowed, so the step waits: allow everything but it.
    const [waiting] = await s.replies();
    expect(waiting.status).toBe("waiting");
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: ["c2"] });
    await s.t.finishAllScheduledFunctions(() => {});
    const [first, second] = s.requests();
    expect(first.messages).toEqual([expect.objectContaining({ role: "system" }), { role: "user", content: "Go" }]);
    expect(second.messages.slice(2)).toEqual([
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "docs__search", arguments: '{"q":"a"}' } },
          { id: "c2", type: "function", function: { name: "docs__delete", arguments: "{}" } },
          { id: "c3", type: "function", function: { name: "docs__search", arguments: '{"fail":true}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "result of search" },
      { role: "tool", tool_call_id: "c2", content: "The user declined this call." },
      { role: "tool", tool_call_id: "c3", content: "Error: no such page" },
    ]);
    expect(s.mcpCalls.map((c) => c.name)).toEqual(["search", "search"]);
    const [reply] = await s.replies();
    expect(reply).toMatchObject({ status: "done", content: "Looking.\n\nDone." });
    expect(reply.steps!.map((x) => x.usage.inputTokens)).toEqual([100, 200]);
    expect(reply.usage).toMatchObject({ inputTokens: 300, outputTokens: 20 });
  });

  test("tools and history are the same bytes on every step, on the next turn and on a retry", async () => {
    const s = await setup((n) => (n % 2 === 1 ? { calls: [call(`c${n}`, "search", { q: n })] } : { text: `answer ${n}` }));
    await s.send("First");
    await s.send("Second");
    const [step1, step2, , next] = s.requests();
    expect(JSON.stringify(step2.tools)).toBe(JSON.stringify(step1.tools));
    // The first step's request is a prefix of the second's, which is a prefix of the next turn's.
    const head = JSON.stringify(step1.messages).slice(0, -1);
    expect(JSON.stringify(step2.messages).startsWith(head)).toBe(true);
    const stepTwo = JSON.stringify(step2.messages).slice(0, -1);
    expect(JSON.stringify(next.messages).startsWith(stepTwo)).toBe(true);

    const [firstReply] = await s.replies();
    const before = s.requests().length;
    await s.owner.mutation(api.chat.retry, { messageId: firstReply._id });
    await s.t.finishAllScheduledFunctions(() => {});
    const retried = s.requests()[before];
    expect(JSON.stringify(retried)).toBe(JSON.stringify(step1));
    expect(await s.replies()).toHaveLength(3);
  });

  test("a call that times out and the step limit behave as on Anthropic", async () => {
    const orig = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => orig(ms === 60_000 ? 50 : ms));
    const s = await setup((n) => ({ calls: [call(`c${n}`, "search")] }), { call: () => new Promise(() => {}) });
    await s.send("Loop");
    expect(s.requests()).toHaveLength(10);
    const [reply] = await s.replies();
    expect(reply).toMatchObject({ status: "done", truncated: true, hitStepLimit: true });
    expect(reply.parts!.filter((p) => p.type === "toolResult")).toHaveLength(9);
    expect(reply.parts!.find((p) => p.type === "toolResult")).toMatchObject({ status: "timedOut" });
    expect(s.requests()[1].messages.at(-1)).toMatchObject({ role: "tool", content: "Error: the call timed out after 60 seconds." });
    vi.restoreAllMocks();
  });
});
