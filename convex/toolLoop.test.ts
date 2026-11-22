/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { fakeMcp, type FakeMcpOptions } from "../test/fakeMcp";
import { gate, gatedStream, type Gate } from "../test/sse";
import {
  messageDelta,
  messageStart,
  messageStop,
  sse,
  textDelta,
  toolUse,
  toolUseStop,
} from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const MCP = "https://docs.example.com/mcp";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.restoreAllMocks();
});

type Block = { type: string; [k: string]: unknown };
type Msg = { role: string; content: string | Block[] };
type Body = { max_tokens: number; stream: boolean; messages: Msg[]; tools?: unknown[]; cache_control?: object };
// What the fake model does for the nth reply request: tool calls, or text to finish with.
type Step = { text?: string; calls?: { id: string; name: string; args: object }[]; thinking?: { thinking: string; signature: string }; gate?: Gate };

const search = { name: "search", description: "Search", inputSchema: JSON.stringify({ type: "object" }) };
const dangerous = { name: "delete", inputSchema: JSON.stringify({ type: "object" }) };
const asFake = (t: { name: string; description?: string; inputSchema: string }) => ({ ...t, inputSchema: JSON.parse(t.inputSchema) as object });

async function setup(opts: { steps: Step[] | ((body: Body, n: number) => Step); mcp?: Partial<FakeMcpOptions>; allowed?: string[]; budget?: number }) {
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
      ownerId, name: "Docs", slug: "docs", url: MCP, headerNames: [], onForNewThreads: true,
      tools: [search, dangerous], alwaysAllowed: opts.allowed ?? ["search"],
    }),
  );
  if (opts.budget !== undefined)
    await t.run((ctx) => ctx.db.insert("settings", { ownerId, allowlistedHosts: [], dailyBudgetMicroUsd: opts.budget }));
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });

  let n = 0;
  const mcpCalls: { name: string; args: object }[] = [];
  const mcpFixtures = fakeMcp(MCP, {
    tools: [search, dangerous].map(asFake),
    call: (name, args) => {
      mcpCalls.push({ name, args });
      return { content: [{ type: "text", text: `result of ${name}` }] };
    },
    ...opts.mcp,
  });
  fake = fakeFetch({
    ...mcpFixtures,
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (body.max_tokens === 30) return new Response(sse(messageStart({ input_tokens: 1 }), textDelta("Title"), messageDelta({ output_tokens: 1 }), messageStop)); // title job
        n += 1;
        const step = typeof opts.steps === "function" ? opts.steps(body, n) : (opts.steps[n - 1] ?? { text: "done" });
        const events: (string | Gate)[] = [messageStart({ input_tokens: 100 * n, cache_read_input_tokens: 0 })];
        if (step.gate) events.push(step.gate); // holds the step before its text
        let index = 0;
        if (step.thinking) {
          const i = index++;
          events.push(
            `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: i, content_block: { type: "thinking", thinking: "" } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: step.thinking.thinking } })}\n\n`,
            `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: i, delta: { type: "signature_delta", signature: step.thinking.signature } })}\n\n`,
            `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: i })}\n\n`,
          );
        }
        if (step.text) events.push(textDelta(step.text));
        for (const c of step.calls ?? []) events.push(toolUse(index++, c.id, c.name, JSON.stringify(c.args)));
        events.push(step.calls ? toolUseStop({ output_tokens: 10 }) : messageDelta({ output_tokens: 10 }), messageStop);
        return new Response(gatedStream(events, init?.signal));
      },
    },
  });
  const settle = () => t.finishAllScheduledFunctions(() => {});
  const send = async (content: string, id: Id<"threads"> = threadId) => {
    await owner.mutation(api.chat.send, { threadId: id, content });
    await settle();
  };
  const replyRequests = () =>
    fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  const replies = () =>
    t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.role === "assistant"));
  return { t, owner, ownerId, threadId, serverId, send, settle, replyRequests, replies, mcpCalls };
}

const call = (id: string, name: string, args: object = {}) => ({ id, name: `docs__${name}`, args });

describe("the tool loop on Anthropic", () => {
  test("an always-allowed call runs, its result goes back, and the reply is the text of every step", async () => {
    const s = await setup({ steps: [{ text: "Let me look.", calls: [call("toolu_1", "search", { q: "cache" })] }, { text: "Found it." }] });
    const log = vi.spyOn(console, "log");
    await s.send("Find the cache docs");

    // Each step logs one timing line when it finishes (spec phase 12, reply timing log).
    const timing = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("reply step "));
    expect(timing).toHaveLength(2);
    for (const line of timing)
      expect(line).toMatch(/^reply step \S+ status=done queue=\d+ms input=\d+ms firstEvent=\d+ms firstText=\d+ms total=\d+ms$/);

    expect(s.mcpCalls).toEqual([{ name: "search", args: { q: "cache" } }]);
    const [first, second] = s.replyRequests();
    // Tools, tool results and a router's own breakpoint must fit Anthropic's limit of 4.
    for (const body of [first, second]) expect(JSON.stringify(body).match(/"cache_control"/g)!.length).toBeLessThanOrEqual(3);
    // A request ending in tool results drops top-level caching: 9router (cc/) adds marks that
    // push a tool_use -> tool_result request over 4 alongside it.
    expect(first.cache_control).toEqual(expect.objectContaining({ type: "ephemeral" }));
    expect(second.cache_control).toBeUndefined();
    expect(first.messages).toEqual([{ role: "user", content: "Find the cache docs" }]);
    expect(second.messages.slice(1)).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "toolu_1", name: "docs__search", input: { q: "cache" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "result of search" }] },
    ]);
    const [reply] = await s.replies();
    expect(reply).toMatchObject({ status: "done", content: "Let me look.\n\nFound it." });
    expect(reply.parts!.map((p) => [p.type, p.step])).toEqual([["text", 1], ["toolCall", 1], ["toolResult", 1], ["text", 2]]);
    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1];
    expect(view.text).toBe("Let me look.\n\nFound it.");
    expect(view.items).toEqual([
      { kind: "text", text: "Let me look." },
      { kind: "tool", id: "toolu_1", tool: "search", server: "Docs", alwaysAllowed: true, status: "ok", input: '{\n  "q": "cache"\n}', result: "result of search" },
      { kind: "text", text: "Found it." },
    ]);
  });

  test("each step's text moves into its parts as it ends, and the next step streams into a fresh row", async () => {
    const [held, step2] = [gate(), gate()];
    const s = await setup({
      steps: [{ text: "Let me look.", calls: [call("toolu_1", "search")] }, { gate: step2, text: "Found it." }],
      mcp: { call: async () => (held.arrive(), await held.released, { content: [{ type: "text", text: "r" }] }) },
    });
    const streams = () => s.t.run((ctx) => ctx.db.query("streams").collect());
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Find it" });
    const settled = s.settle();

    await held.reached; // step 1 ended, tools running
    expect((await s.replies())[0]?.parts?.length).toBe(2);
    const id = (await s.replies())[0]._id;
    expect(await s.owner.query(api.chat.streamingText, { messageId: id })).toBeNull();
    expect(await streams()).toEqual([]);
    expect((await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1]).toMatchObject({
      status: "streaming",
      text: "",
      items: [{ kind: "text", text: "Let me look." }, { kind: "tool", status: "running" }],
    });

    held.release();
    await step2.reached;
    expect(await s.owner.query(api.chat.streamingText, { messageId: id })).toBe(""); // a fresh row, not step 1's text
    step2.release();
    await settled;
    expect(await streams()).toEqual([]);
    expect((await s.replies())[0]).toMatchObject({ status: "done", content: "Let me look.\n\nFound it." });
  });

  test("each step is metered as it finishes; the reply's total is the sum and the breakdown lists each", async () => {
    const s = await setup({ steps: [{ calls: [call("t1", "search")] }, { calls: [call("t2", "search")] }, { text: "ok" }] });
    await s.send("Go");
    const [reply] = await s.replies();
    expect(reply.steps).toHaveLength(3);
    expect(reply.steps!.map((x) => x.usage.inputTokens)).toEqual([100, 200, 300]);
    expect(reply.usage).toMatchObject({ inputTokens: 600, outputTokens: 30 });
    expect(reply.costMicroUsd).toBe(reply.steps!.reduce((sum, x) => sum + x.costMicroUsd!, 0));
    const turn = (await s.owner.query(api.inspector.turn, { messageId: reply._id }))!;
    expect(turn.steps.map((x) => x.usage.inputTokens)).toEqual([100, 200, 300]);
    // The inspector measures the next request from the last step: it holds every earlier one.
    const view = (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!;
    const [tools, system, turns] = view.layers;
    expect([tools.kind, system.kind, turns.kind]).toEqual(["tools", "system", "turns"]);
    expect(turns.tokens).toBe(300 + 10 - tools.tokens - system.tokens);
    // The usage rollups saw every step too.
    const rollup = await s.t.run(async (ctx) => (await ctx.db.query("dailyUsage").collect()).find((r) => r.dimension === "thread")!);
    expect(rollup.calls).toBe(4); // three steps and the title
  });

  test("calls in one step run in parallel and their results go back together, in order", async () => {
    let live = 0;
    let peak = 0;
    const s = await setup({
      steps: [{ calls: [call("a", "search", { q: 1 }), call("b", "search", { q: 2 })] }, { text: "ok" }],
      mcp: {
        call: async (name, args) => {
          peak = Math.max(peak, ++live);
          await new Promise((r) => setTimeout(r, 30));
          live--;
          return { content: [{ type: "text", text: `r${(args as { q: number }).q}` }] };
        },
      },
    });
    await s.send("Go");
    expect(peak).toBe(2);
    const results = (s.replyRequests()[1].messages.at(-1)!.content as Block[]).map((b) => [b.tool_use_id, b.content]);
    expect(results).toEqual([["a", "r1"], ["b", "r2"]]);
  });

  test("a call over 60 seconds becomes a timed-out result", async () => {
    const orig = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => orig(ms === 60_000 ? 50 : ms));
    const s = await setup({
      steps: [{ calls: [call("slow", "search")] }, { text: "It timed out." }],
      mcp: { call: () => new Promise(() => {}) }, // never answers
    });
    await s.send("Go");
    const parts = (await s.replies())[0].parts!;
    expect(parts.find((p) => p.type === "toolResult")).toMatchObject({ status: "timedOut" });
    expect(s.replyRequests()[1].messages.at(-1)!.content).toEqual([
      { type: "tool_result", tool_use_id: "slow", content: "Error: the call timed out after 60 seconds.", is_error: true },
    ]);
    expect((await s.replies())[0].status).toBe("done");
  });

  test("an unreachable server, a failing tool and a removed tool are error results, never a failed reply", async () => {
    const s = await setup({
      steps: [{ calls: [call("down", "search")] }, { calls: [call("bad", "search")] }, { calls: [call("gone", "search")] }, { text: "ok" }],
      mcp: { status: 503, tools: [asFake(search)] },
    });
    await s.send("Go");
    const results = (await s.replies())[0].parts!.filter((p) => p.type === "toolResult");
    expect(results.map((r) => (r.type === "toolResult" ? r.status : ""))).toEqual(["error", "error", "error"]);
    expect((await s.replies())[0].status).toBe("done");

    // Removed: the server's refreshed list no longer has the tool, so no request is made at all.
    const s2 = await setup({ steps: [{ text: "hi" }, { calls: [call("gone", "search")] }, { text: "ok" }] });
    await s2.send("Hello");
    await s2.t.run((ctx) => ctx.db.patch("toolServers", s2.serverId, { tools: [dangerous] }));
    await s2.send("Go");
    expect(s2.mcpCalls).toEqual([]);
    expect(s2.replyRequests()[2].messages.at(-1)!.content).toEqual([
      { type: "tool_result", tool_use_id: "gone", content: "Error: the server no longer offers this tool", is_error: true },
    ]);
  });

  test("an MCP error result keeps its text and is marked as an error", async () => {
    const s = await setup({
      steps: [{ calls: [call("e", "search")] }, { text: "ok" }],
      mcp: { call: () => ({ isError: true, content: [{ type: "text", text: "bad query" }] }) },
    });
    await s.send("Go");
    expect(s.replyRequests()[1].messages.at(-1)!.content).toEqual([
      { type: "tool_result", tool_use_id: "e", content: "Error: bad query", is_error: true },
    ]);
  });

  test("non-text content becomes a note; a long result is cut with a note; the stored text is the text sent, now and next turn", async () => {
    const s = await setup({
      steps: [{ calls: [call("img", "search"), call("big", "search", { q: "x" })] }, { text: "ok" }, { text: "again" }],
      mcp: {
        call: (_name, args) => ({
          content: (args as { q?: string }).q
            ? [{ type: "text", text: "y".repeat(40_000) }]
            : [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "caption" }],
        }),
      },
    });
    await s.send("Go");
    const sent = (s.replyRequests()[1].messages.at(-1)!.content as Block[]).map((b) => b.content as string);
    expect(sent[0]).toBe("[image omitted]\ncaption");
    expect(sent[1]).toBe(`${"y".repeat(32_000)}\n[result truncated at ~8k tokens]`);
    const stored = (await s.replies())[0].parts!.filter((p) => p.type === "toolResult").map((p) => (p.type === "toolResult" ? p.text : ""));
    expect(stored).toEqual(sent);
    await s.send("Next");
    const history = s.replyRequests()[2].messages.find((m) => Array.isArray(m.content) && m.content[0]?.type === "tool_result")!;
    expect((history.content as Block[]).map((b) => b.content)).toEqual(sent);
  });

  test("thinking blocks go back unchanged, signature and all, across steps and on the next turn", async () => {
    const thinking = { thinking: "hmm", signature: "sig-123" };
    const s = await setup({ steps: [{ thinking, text: "Looking.", calls: [call("t", "search")] }, { text: "Done." }, { text: "Next answer." }] });
    await s.send("Go");
    const expected = [
      { type: "thinking", thinking: "hmm", signature: "sig-123" },
      { type: "text", text: "Looking." },
      { type: "tool_use", id: "t", name: "docs__search", input: {} },
    ];
    expect(s.replyRequests()[1].messages[1].content).toEqual(expected);
    await s.send("And then?");
    const third = s.replyRequests()[2].messages;
    expect(third.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(third[1].content).toEqual(expected);
    expect(third[2].content).toEqual([{ type: "tool_result", tool_use_id: "t", content: "result of search" }]);
    expect(third[3].content).toBe("Done.");
  });

  test("a stopped reply leaves no call without its result in the next request", async () => {
    const hang = gate();
    const s = await setup({
      steps: [{ text: "Working.", calls: [call("h", "search")] }],
      mcp: { call: async () => (hang.arrive(), await hang.released, { content: [{ type: "text", text: "late" }] }) },
    });
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Go" });
    const running = s.settle();
    await hang.reached;
    expect((await s.replies())[0].parts?.some((p) => p.type === "toolCall")).toBe(true);
    const [reply] = await s.replies();
    await s.owner.mutation(api.chat.stop, { messageId: reply._id });
    await running;
    hang.release();
    const [stopped] = await s.replies();
    expect(stopped.status).toBe("stopped");
    expect(stopped.content).toBe("Working.");
    // The next turn carries the text only, no dangling tool_use.
    await s.send("Hello?");
    expect(s.replyRequests()[1].messages).toEqual([
      { role: "user", content: "Go" },
      { role: "assistant", content: "Working." },
      { role: "user", content: "Hello?" },
    ]);
  }, 15000);

  test("step ten ends the reply as truncated; Continue asks again", async () => {
    const s = await setup({ steps: (_b, n) => (n <= 12 ? { text: `step ${n}`, calls: [call(`t${n}`, "search")] } : { text: "finished" }) });
    await s.send("Loop forever");
    expect(s.replyRequests()).toHaveLength(10);
    const [reply] = await s.replies();
    expect(reply).toMatchObject({ status: "done", truncated: true, hitStepLimit: true });
    // The tenth step's calls were never run, and aren't kept, so the history stays valid.
    expect(reply.parts!.filter((p) => p.type === "toolCall")).toHaveLength(9);
    await s.send("Continue.");
    const next = s.replyRequests()[10].messages;
    expect(next.at(-1)).toEqual({ role: "user", content: "Continue." });
    expect(JSON.stringify(next)).not.toContain("t10");
  });

  test("the daily budget is checked before every step", async () => {
    const s = await setup({ steps: [{ calls: [call("t", "search")] }, { text: "never" }], budget: 1 });
    await s.send("Go");
    expect(s.replyRequests()).toHaveLength(1);
    const [reply] = await s.replies();
    expect(reply).toMatchObject({ status: "error", error: "Daily budget reached" });
    expect(reply.costMicroUsd).toBeGreaterThan(1);
  });

  test("Retry runs the whole loop again as a sibling reply", async () => {
    const s = await setup({ steps: (_b, n) => (n % 2 === 1 ? { calls: [call(`t${n}`, "search")] } : { text: `answer ${n}` }) });
    await s.send("Go");
    const [first] = await s.replies();
    await s.owner.mutation(api.chat.retry, { messageId: first._id });
    await s.settle();
    const replies = await s.replies();
    expect(replies).toHaveLength(2);
    expect(replies[1].parts!.map((p) => p.type)).toEqual(["toolCall", "toolResult", "text"]);
    expect(replies[1].parentId).toBe(first.parentId);
    expect(s.mcpCalls).toHaveLength(2);
  });
});

const pending = (s: Awaited<ReturnType<typeof setup>>) => s.replies().then(([r]) => r);

describe("approving tool calls", () => {
  test("a call to a tool that isn't always allowed pauses the reply with one prompt for the step; nothing runs", async () => {
    const s = await setup({ steps: [{ text: "I'll clean up.", calls: [call("d", "delete"), call("q", "search", { q: "x" })] }, { text: "Done." }] });
    await s.send("Clean up");
    const reply = await pending(s);
    expect(reply).toMatchObject({ status: "waiting", content: "" });
    expect(reply.pendingApproval).toMatchObject({ step: 1, callIds: ["d", "q"] });
    expect(s.mcpCalls).toEqual([]); // the always-allowed call waits with the other
    expect(s.replyRequests()).toHaveLength(1);
    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1];
    expect(view.status).toBe("waiting");
    expect(view.items!.filter((i) => i.kind === "tool").map((i) => (i.kind === "tool" ? [i.tool, i.status, i.alwaysAllowed] : []))).toEqual([
      ["delete", "waiting", false],
      ["search", "waiting", true],
    ]);
    // Nothing else can be sent until it is answered or stopped.
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi" })).rejects.toThrow("Wait for the reply to finish");
  });

  test("allowing runs every call of the step in parallel and the results go back together", async () => {
    const s = await setup({ steps: [{ calls: [call("d", "delete"), call("q", "search", { q: "x" })] }, { text: "Done." }] });
    await s.send("Clean up");
    const id = (await pending(s))._id;
    await s.owner.mutation(api.chat.approveTools, { messageId: id, declined: [] });
    await s.settle();
    expect(s.mcpCalls.map((c) => c.name).sort()).toEqual(["delete", "search"]);
    expect(s.replyRequests()[1].messages.at(-1)!.content).toEqual([
      { type: "tool_result", tool_use_id: "d", content: "result of delete" },
      { type: "tool_result", tool_use_id: "q", content: "result of search" },
    ]);
    expect(await pending(s)).toMatchObject({ status: "done", content: "Done." });
    expect((await pending(s)).pendingApproval).toBeUndefined();
  });

  test("declining a call tells the model and the loop continues; the others still run", async () => {
    const s = await setup({ steps: [{ calls: [call("d", "delete"), call("q", "search", { q: "x" })] }, { text: "I left it alone." }] });
    await s.send("Clean up");
    const id = (await pending(s))._id;
    await expect(s.owner.mutation(api.chat.approveTools, { messageId: id, declined: ["nope"] })).rejects.toThrow("isn't waiting");
    await s.owner.mutation(api.chat.approveTools, { messageId: id, declined: ["d"] });
    await s.settle();
    expect(s.mcpCalls.map((c) => c.name)).toEqual(["search"]);
    expect(s.replyRequests()[1].messages.at(-1)!.content).toEqual([
      { type: "tool_result", tool_use_id: "d", content: "The user declined this call.", is_error: true },
      { type: "tool_result", tool_use_id: "q", content: "result of search" },
    ]);
    expect(await pending(s)).toMatchObject({ status: "done", content: "I left it alone." });
    await expect(s.owner.mutation(api.chat.approveTools, { messageId: id, declined: [] })).rejects.toThrow("Nothing is waiting");
  });

  test("Stop cancels a pending approval and ends the reply", async () => {
    const s = await setup({ steps: [{ text: "Working.", calls: [call("d", "delete")] }, { text: "Hello again." }] });
    await s.send("Clean up");
    const id = (await pending(s))._id;
    await s.owner.mutation(api.chat.stop, { messageId: id });
    expect(await pending(s)).toMatchObject({ status: "stopped", content: "Working." });
    expect((await pending(s)).pendingApproval).toBeUndefined();
    await s.settle();
    expect(s.mcpCalls).toEqual([]);
    // The thread is usable again, and the history holds no unanswered call.
    await s.send("Hi");
    expect(s.replyRequests()[1].messages.map((m) => m.content)).toEqual(["Clean up", "Working.", "Hi"]);
  });

  test("an approval left for 30 minutes stops the reply with Continue; the expiry is scheduled when it starts waiting", async () => {
    const s = await setup({ steps: [{ calls: [call("d", "delete")] }, { text: "Continuing." }] });
    await s.send("Clean up");
    const reply = await pending(s);
    const jobs = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const expiry = jobs.find((j) => j.name.includes("expireApproval"))!;
    expect(expiry.scheduledTime).toBe(reply.pendingApproval!.requestedAt + 30 * 60_000);
    // Answering first makes the job a no-op; here nobody answers.
    await s.t.mutation(internal.chat.expireApproval, { messageId: reply._id, step: 1 });
    expect(await pending(s)).toMatchObject({ status: "stopped", truncated: true, approvalExpired: true });
    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[1];
    expect(view.approvalExpired).toBe(true);
    await s.send("Continue.");
    expect(s.replyRequests()[1].messages.at(-1)).toEqual({ role: "user", content: "Continue." });
  });

  test("the stuck-reply sweep leaves a waiting reply alone, and closes one whose expiry was lost", async () => {
    const s = await setup({ steps: [{ calls: [call("d", "delete")] }] });
    await s.send("Clean up");
    const id = (await pending(s))._id;
    await s.t.run((ctx) => ctx.db.patch("messages", id, { stepStartedAt: 1 }));
    expect(await s.t.mutation(internal.chat.sweepStuckReplies, {})).toBe(0);
    expect((await pending(s)).status).toBe("waiting");
    await s.t.run((ctx) => ctx.db.patch("messages", id, { pendingApproval: { step: 1, callIds: ["d"], requestedAt: Date.now() - 40 * 60_000 } }));
    expect(await s.t.mutation(internal.chat.sweepStuckReplies, {})).toBe(1);
    expect(await pending(s)).toMatchObject({ status: "stopped", approvalExpired: true });
  });

  test("keepalive keeps the cache warm while the approval waits, through the reply's last stored part, until 30 minutes pass", async () => {
    const s = await setup({ steps: [{ text: "Ok.", calls: [call("d", "delete")] }] });
    await s.send("Clean up");
    const [reply] = await s.replies();
    // The first step's request wrote the cache; nobody has typed in the thread (no presence).
    await s.t.run((ctx) => ctx.db.patch("messages", reply._id, { usage: { ...reply.usage!, cacheWriteTokens5m: 100 } }));
    const input = (now: number) => s.t.query(internal.keepalive.input, { threadId: s.threadId, now, warm: true });
    const requestedAt = reply.pendingApproval!.requestedAt;
    const waiting = await input(requestedAt + 5 * 60_000);
    expect(waiting).not.toBeNull();
    // The prefix runs through the step's text; its unanswered call is not part of it.
    expect(waiting!.history).toEqual([{ role: "user", content: "Clean up" }, { role: "assistant", content: "Ok." }]);
    expect(waiting!.tools).toHaveLength(2);
    expect(await input(requestedAt + 31 * 60_000)).toBeNull();
  });
});
