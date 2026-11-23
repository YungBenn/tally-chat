/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta, toolUse, toolUseStop } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { builtinTools, type BuiltinTool } from "./lib/builtinTools";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

// A stub built-in tool, registered for each test: echoes its input, and is offered unless switched off.
const echoSchema = JSON.stringify({ type: "object", properties: { say: { type: "string" } } });
let offered = true;
const runs: string[] = [];
const echo: BuiltinTool = {
  name: "echo",
  approval: "never",
  definition: async () => (offered ? { description: "Echo it back", inputSchema: echoSchema } : null),
  run: async (_ctx, { input }) => {
    runs.push(input);
    return { text: `echo ${input}`, status: "ok" };
  },
};
beforeEach(() => {
  offered = true;
  runs.length = 0;
  echo.approval = "never";
  builtinTools.push(echo);
});
afterEach(() => void builtinTools.splice(builtinTools.indexOf(echo), 1));

type Block = { type: string; [k: string]: unknown };
type Body = { max_tokens: number; messages: { role: string; content: string | Block[] }[]; tools?: { name: string; description?: string; input_schema: unknown }[] };
type Step = { text?: string; calls?: { id: string; name: string; args: object }[] };

async function setup(steps: Step[] = []) {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const serverId = await t.run((ctx) =>
    ctx.db.insert("toolServers", {
      ownerId, name: "Docs", slug: "docs", url: "https://docs.example.com/mcp", headerNames: [], onForNewThreads: true,
      tools: [{ name: "search", description: "Search", inputSchema: JSON.stringify({ type: "object" }) }], alwaysAllowed: ["search"],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  await owner.mutation(api.settings.setAddSkillOnForNewThreads, { on: false }); // these tests are about other tools
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  let n = 0;
  // Only the model is faked: a call reaching any tool server would fail the fetch.
  fake = fakeFetch({
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
  const send = async (tools?: ({ serverId: Id<"toolServers">; tool: string } | { builtin: string })[]) => {
    await owner.mutation(api.chat.send, { threadId, content: "Hi", tools });
    await settle();
  };
  const replyRequests = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const reply = () => t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((m) => m.role === "assistant")!);
  return { t, owner, threadId, serverId, send, settle, replyRequests, reply };
}

describe("built-in tools in a thread's tool set", () => {
  test("the first send freezes offered built-in tools before the servers' tools, and the inspector counts them", async () => {
    const s = await setup();
    await s.send();
    const [body] = s.replyRequests();
    expect(body.tools).toEqual([
      { name: "echo", description: "Echo it back", input_schema: JSON.parse(echoSchema) },
      { name: "docs__search", description: "Search", input_schema: { type: "object" } },
    ]);
    const view = (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!;
    const toolsLayer = view.layers.find((l) => l.kind === "tools")!;
    expect(toolsLayer.label).toBe("2 tools");
    expect(toolsLayer.tokens).toBe(
      Math.ceil(JSON.stringify([
        { name: "echo", description: "Echo it back", inputSchema: echoSchema },
        { name: "docs__search", description: "Search", inputSchema: JSON.stringify({ type: "object" }) },
      ]).length / 4),
    );
  });

  test("a built-in tool that isn't offered is left out by default and refused when picked", async () => {
    offered = false;
    const s = await setup();
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", tools: [{ builtin: "echo" }] })).rejects.toThrow("no longer offered");
    await s.send();
    expect(s.replyRequests()[0].tools!.map((x) => x.name)).toEqual(["docs__search"]);
  });

  test("a call to a built-in tool runs its handler without a tool server or approval; the result goes back", async () => {
    const s = await setup([{ calls: [{ id: "toolu_1", name: "echo", args: { say: "hi" } }] }, { text: "Done." }]);
    await s.send([{ builtin: "echo" }]);
    expect(runs).toEqual([JSON.stringify({ say: "hi" })]);
    const [first, second] = s.replyRequests();
    expect(first.tools!.map((x) => x.name)).toEqual(["echo"]);
    expect(second.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: `echo ${JSON.stringify({ say: "hi" })}` }],
    });
    expect((await s.reply()).status).toBe("done");
  });

  test("a built-in tool marked as always needing approval waits for the owner", async () => {
    echo.approval = "always";
    const s = await setup([{ calls: [{ id: "toolu_1", name: "echo", args: {} }] }, { text: "Done." }]);
    await s.send([{ builtin: "echo" }]);
    const waiting = await s.reply();
    expect(waiting.status).toBe("waiting");
    expect(runs).toEqual([]);
    await s.owner.mutation(api.chat.approveTools, { messageId: waiting._id, declined: [] });
    await s.settle();
    expect(runs).toEqual(["{}"]);
    expect((await s.reply()).status).toBe("done");
  });

  test("an existing thread's tools change to built-in picks through the set-thread-tools path", async () => {
    const s = await setup();
    await s.send([{ serverId: s.serverId, tool: "search" }]);
    await s.owner.mutation(api.chat.setThreadTools, { threadId: s.threadId, tools: [{ serverId: s.serverId, tool: "search" }, { builtin: "echo" }] });
    expect((await s.owner.query(api.chat.threadTools, { threadId: s.threadId }))!.picks).toEqual([{ builtin: "echo" }, { serverId: s.serverId, tool: "search" }]);
    const cost = await s.owner.query(api.inspector.toolChange, { threadId: s.threadId, now: Date.now(), tools: [{ builtin: "echo" }] });
    expect(cost.newToolTokens).toBe(Math.ceil(JSON.stringify([{ name: "echo", description: "Echo it back", inputSchema: echoSchema }]).length / 4));
    await s.send();
    expect(s.replyRequests()[1].tools!.map((x) => x.name)).toEqual(["echo", "docs__search"]);
  });
});
