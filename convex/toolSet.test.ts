/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import {
  messageDelta,
  messageStart,
  messageStop,
  oaiDelta,
  oaiDone,
  oaiFinish,
  sse,
  textDelta,
} from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";
const FIVE_MIN = { type: "ephemeral", ttl: "5m" };

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = { max_tokens: number; system: unknown; tools?: { name: string; description?: string; input_schema: unknown; cache_control?: unknown }[]; stream: boolean };
const search = { name: "search", description: "Search the docs", inputSchema: JSON.stringify({ type: "object", properties: { q: { type: "string" } }, $schema: "http://json-schema.org/draft-07/schema#" }) };
const read = { name: "read.file", inputSchema: JSON.stringify({ type: "object" }) };

async function setup() {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const anthropicId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ...base, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
        { id: "no-tools", displayName: "No tools", hidden: false, tools: false },
      ],
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
  const server = (name: string, slug: string, tools: object[], onForNewThreads = true) =>
    t.run((ctx) =>
      ctx.db.insert("toolServers", {
        ownerId, name, slug, url: `https://${slug}.example.com/mcp`, headerNames: [], onForNewThreads,
        tools: tools as never, alwaysAllowed: [],
      }),
    );
  const docsId = await server("Docs", "docs", [search, read]);
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const thread = (providerId: Id<"providers">, modelId: string) => owner.mutation(api.chat.createThread, { providerId, modelId });
  const reply = [messageStart({ input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 }), textDelta("ok"), messageDelta({ output_tokens: 2 }), messageStop];
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) =>
        (JSON.parse(String(init?.body)) as Body).stream
          ? new Response(sse(...reply))
          : Response.json({ usage: { input_tokens: 3, cache_read_input_tokens: 2000, output_tokens: 0 } }),
    },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 10, completion_tokens: 2 }) + oaiDone },
  });
  const send = async (threadId: Id<"threads">, content: string, tools?: { serverId: Id<"toolServers">; tool: string }[]) => {
    await owner.mutation(api.chat.send, { threadId, content, tools });
    await t.finishAllScheduledFunctions(() => {});
  };
  const anthropicBodies = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).stream && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body); // title jobs (max_tokens 30) carry no tools
  return { t, owner, ownerId, anthropicId, openaiId, docsId, server, thread, send, anthropicBodies };
}

describe("freezing a tool set", () => {
  test("the first send freezes the on-for-new-threads servers' tools; names carry the server's slug", async () => {
    const s = await setup();
    await s.server("Off", "off", [{ name: "x", inputSchema: "{}" }], false);
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(threadId, "Hi");
    const row = await s.t.run((ctx) => ctx.db.get("threads", threadId));
    expect(row!.toolSet!.map((x) => [x.name, x.tool])).toEqual([["docs__search", "search"], ["docs__read_file", "read.file"]]);
    expect(row!.toolSet![0].inputSchema).toBe(search.inputSchema);
  });

  test("Anthropic: tools come first, covered by the system prompt's breakpoint; schema keys such as $schema survive", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(threadId, "Hi");
    const [body] = s.anthropicBodies();
    expect(Object.keys(body).indexOf("tools")).toBeLessThan(Object.keys(body).indexOf("system"));
    expect(body.tools!.map((x) => x.name)).toEqual(["docs__search", "docs__read_file"]);
    expect(body.tools![0]).toEqual({ name: "docs__search", description: "Search the docs", input_schema: JSON.parse(search.inputSchema) });
    // The system prompt's breakpoint covers the tools before it; no request goes over 4 breakpoints.
    expect(body.tools!.every((x) => x.cache_control === undefined)).toBe(true);
    expect(body.system).toEqual([expect.objectContaining({ cache_control: FIVE_MIN })]);
    expect(JSON.stringify(body).match(/"cache_control"/g)!.length).toBeLessThanOrEqual(3);
    expect(body.tools![1].description).toBeUndefined();
  });

  test("later requests send byte-identical tools after the server's tool list changes", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(threadId, "Hi");
    await s.t.run((ctx) => ctx.db.patch("toolServers", s.docsId, { tools: [{ name: "search", description: "CHANGED", inputSchema: "{}" }] }));
    await s.send(threadId, "Again");
    const bodies = s.anthropicBodies();
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1].tools)).toBe(JSON.stringify(bodies[0].tools));
  });

  test("keepalive sends the same tools", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(threadId, "Hi");
    await s.owner.mutation(api.chat.markActive, { threadId });
    await s.t.action(internal.chatActions.keepalive, { threadId, warm: true });
    const keepalive = fake!.requests.find((r) => (r.body as Body).stream === false)!.body as Body;
    expect(JSON.stringify(keepalive.tools)).toBe(JSON.stringify(s.anthropicBodies()[0].tools));
  });

  test("explicit picks choose tools; an empty pick sends none; unknown tools and tool-less models are refused", async () => {
    const s = await setup();
    const a = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(a, "Hi", [{ serverId: s.docsId, tool: "read.file" }]);
    expect(s.anthropicBodies()[0].tools!.map((x) => x.name)).toEqual(["docs__read_file"]);

    const b = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(b, "Hi", []);
    expect(s.anthropicBodies()[1].tools).toBeUndefined();
    expect((await s.t.run((ctx) => ctx.db.get("threads", b)))!.toolSet).toBeUndefined();

    const c = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await expect(s.owner.mutation(api.chat.send, { threadId: c, content: "Hi", tools: [{ serverId: s.docsId, tool: "gone" }] })).rejects.toThrow("no longer offered");

    const d = await s.thread(s.anthropicId, "no-tools");
    await expect(s.owner.mutation(api.chat.send, { threadId: d, content: "Hi", tools: [{ serverId: s.docsId, tool: "search" }] })).rejects.toThrow("can't call tools");
    await s.send(d, "Hi"); // the default on a tool-less model is no tools
    expect(s.anthropicBodies()[2].tools).toBeUndefined();
  });

  test("a model without tools gets none; the Providers list says which models can call tools", async () => {
    const s = await setup();
    const providers = await s.owner.query(api.providers.list, {});
    const flags = (name: string) => providers.find((p) => p.name === name)!.models.map((m) => [m.id, m.tools]);
    expect(flags("A")).toEqual([["claude-sonnet-5-5", true], ["no-tools", false]]);
    expect(flags("OpenAI")).toEqual([["gpt-5", true], ["plain", false]]);
    const t = await s.thread(s.openaiId, "plain");
    await s.send(t, "Hi");
    expect((fake!.requests.at(-1)!.body as { tools?: unknown }).tools).toBeUndefined();
  });

  test("OpenAI-compatible: tools go in the standard field, in the same order every time", async () => {
    const s = await setup();
    const threadId = await s.thread(s.openaiId, "gpt-5");
    await s.send(threadId, "Hi");
    await s.send(threadId, "Again");
    const sent = fake!.requests
      .filter((r) => r.url.includes("chat/completions") && (r.body as { max_tokens?: number }).max_tokens !== 30) // not the title job
      .map((r) => (r.body as { tools: unknown[] }).tools);
    expect(sent[0]).toEqual([
      { type: "function", function: { name: "docs__search", description: "Search the docs", parameters: JSON.parse(search.inputSchema) } },
      { type: "function", function: { name: "docs__read_file", parameters: { type: "object" } } },
    ]);
    expect(JSON.stringify(sent[1])).toBe(JSON.stringify(sent[0]));
  });
});

describe("the inspector's Tools layer", () => {
  test("lists the tool definitions above the system prompt and the turns still add up", async () => {
    const s = await setup();
    const threadId = await s.thread(s.anthropicId, "claude-sonnet-5-5");
    await s.send(threadId, "Hi");
    const view = (await s.owner.query(api.inspector.get, { threadId }))!;
    expect(view.layers.map((l) => l.kind)).toEqual(["tools", "system", "turns"]);
    const tools = view.layers[0];
    expect(tools).toMatchObject({ label: "2 tools", estimated: true });
    const frozen = await s.t.run(async (ctx) => (await ctx.db.get("threads", threadId))!.toolSet!);
    expect(tools.tokens).toBe(Math.ceil(JSON.stringify(frozen.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length / 4));
  });
});
