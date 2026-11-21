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

type Body = { max_tokens: number; stream: boolean; tools?: { name: string; description?: string }[] };
const search = { name: "search", description: "Search the docs", inputSchema: JSON.stringify({ type: "object" }) };
const read = { name: "read", description: "Read a file", inputSchema: JSON.stringify({ type: "object" }) };

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
  const plainId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "Plain", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      models: [{ id: "plain", displayName: "Plain", hidden: false }],
    }),
  );
  const serverId = await t.run((ctx) =>
    ctx.db.insert("toolServers", {
      ownerId, name: "Docs", slug: "docs", url: "https://docs.example.com/mcp", headerNames: [], onForNewThreads: true,
      tools: [search, read], alwaysAllowed: [],
    }),
  );
  fake = fakeFetch({
    [ANTHROPIC]: {
      body: sse(messageStart({ input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 }), textDelta("ok"), messageDelta({ output_tokens: 2 }), messageStop),
    },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 10, completion_tokens: 2 }) + oaiDone },
  });
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const thread = async (providerId: Id<"providers">, modelId: string) => {
    const id = await owner.mutation(api.chat.createThread, { providerId, modelId });
    await owner.mutation(api.chat.send, { threadId: id, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    return id;
  };
  const replyTools = () =>
    fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).stream && (r.body as Body).max_tokens !== 30).map((r) => (r.body as Body).tools);
  return { t, owner, ownerId, anthropicId, plainId, serverId, thread, replyTools };
}

describe("changing a thread's tool set", () => {
  test("confirming replaces the frozen set with the current definitions; the next request sends them", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    // The server changed since the thread froze its tools.
    await s.t.run((ctx) => ctx.db.patch("toolServers", s.serverId, { tools: [{ ...search, description: "Search, now smarter" }, read] }));
    await s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [{ serverId: s.serverId, tool: "search" }] });
    expect((await s.t.run((ctx) => ctx.db.get("threads", threadId)))!.toolSet).toMatchObject([{ name: "docs__search", description: "Search, now smarter" }]);

    await s.owner.mutation(api.chat.send, { threadId, content: "Again" });
    await s.t.finishAllScheduledFunctions(() => {});
    const [first, second] = s.replyTools();
    expect(first!.map((x) => x.name)).toEqual(["docs__search", "docs__read"]);
    expect(second).toEqual([expect.objectContaining({ name: "docs__search", description: "Search, now smarter" })]);
  });

  test("an empty pick removes the tools; a tool-less model can't take any; unknown tools are refused", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await expect(s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [{ serverId: s.serverId, tool: "gone" }] })).rejects.toThrow("no longer offered");
    expect((await s.t.run((ctx) => ctx.db.get("threads", threadId)))!.toolSet).toHaveLength(2); // a refused change changes nothing
    await s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [] });
    await s.owner.mutation(api.chat.send, { threadId, content: "Again" });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.replyTools()[1]).toBeUndefined();

    const plain = await s.thread(s.plainId, "plain");
    await expect(s.owner.mutation(api.chat.setThreadTools, { threadId: plain, tools: [{ serverId: s.serverId, tool: "search" }] })).rejects.toThrow("can't call tools");
  });

  test("it is refused while a reply runs, and another owner can't change the thread", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    const reply = (await s.owner.query(api.chat.getThread, { threadId }))!.messages[1];
    await s.t.run((ctx) => ctx.db.patch("messages", reply._id, { status: "streaming" }));
    await expect(s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [] })).rejects.toThrow("Wait for the reply");
    const otherId = await s.t.run((ctx) => ctx.db.insert("users", { email: "other" }));
    const other = s.t.withIdentity({ subject: `${otherId}|session` });
    await expect(other.mutation(api.chat.setThreadTools, { threadId, tools: [] })).rejects.toThrow("not found");
    expect(await other.query(api.chat.threadTools, { threadId })).toBeNull();
  });

  test("the cache reads cold after a change, and a keepalive is queued to write the new prefix", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    expect((await s.t.run((ctx) => threadState(ctx, threadId)))?.cacheTouchedAt).toBeDefined();
    await s.owner.mutation(api.chat.setThreadTools, { threadId, tools: [{ serverId: s.serverId, tool: "read" }] });
    expect((await s.t.run((ctx) => threadState(ctx, threadId)))?.cacheTouchedAt).toBeUndefined();
    const jobs = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("keepalive") && j.state.kind === "pending")).toBe(true);
  });

  test("the sidebar knows which threads' models can call tools, and the dialog starts from the thread's picks", async () => {
    const s = await setup();
    const a = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    const p = await s.thread(s.plainId, "plain");
    const rows = await s.owner.query(api.chat.listThreads, {});
    expect(rows.find((r) => r._id === a)!.tools).toBe(true);
    expect(rows.find((r) => r._id === p)!.tools).toBe(false);
    expect(await s.owner.query(api.chat.threadTools, { threadId: a })).toEqual({
      capable: true,
      picks: [{ serverId: s.serverId, tool: "search" }, { serverId: s.serverId, tool: "read" }],
    });
    expect(await s.owner.query(api.chat.threadTools, { threadId: p })).toEqual({ capable: false, picks: [] });
  });
});

describe("pricing a change", () => {
  test("the extra cost is the new prefix written to the cache, less the old one read from it", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    const now = Date.now();
    const view = (await s.owner.query(api.inspector.get, { threadId }))!;
    const current = view.layers.reduce((sum, l) => sum + l.tokens, 0);
    const oldTools = view.layers.find((l) => l.kind === "tools")!.tokens;

    const none = await s.owner.query(api.inspector.toolChange, { threadId, now, tools: [] });
    expect(none.newToolTokens).toBe(0);
    expect(none.prefixTokens).toBe(current - oldTools);
    // Sonnet 5.5 (per token): cache write $2.50/MTok, cache read $0.10/MTok; the cache is warm.
    expect(none.extraMicroUsd).toBe(Math.max(0, Math.round(((current - oldTools) * 2.5e-6 - current * 0.1e-6) * 1e6)));

    const same = await s.owner.query(api.inspector.toolChange, { threadId, now, tools: [{ serverId: s.serverId, tool: "search" }, { serverId: s.serverId, tool: "read" }] });
    expect(same.prefixTokens).toBe(current);
    // Cold, the same prefix costs a write either way, so only the tokens that changed matter.
    const cold = await s.owner.query(api.inspector.toolChange, { threadId, now: now + 10 * 60_000, tools: [{ serverId: s.serverId, tool: "search" }, { serverId: s.serverId, tool: "read" }] });
    expect(cold.extraMicroUsd).toBe(0);
  });

  test("a model without a price has no estimate", async () => {
    const s = await setup();
    const threadId = await s.thread(s.plainId, "plain");
    const out = await s.owner.query(api.inspector.toolChange, { threadId, now: Date.now(), tools: [] });
    expect(out.extraMicroUsd).toBeNull();
  });
});
