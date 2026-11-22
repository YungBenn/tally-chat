/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cacheState } from "./lib/cacheStatus";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SUMMARY_PREFIX } from "./lib/context";
import { CURRENT_SYSTEM_PROMPT_VERSION, SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

const FIVE_MIN = { type: "ephemeral", ttl: "5m" };
type Body = { max_tokens: number; system: unknown; messages: { role: string; content: unknown }[]; cache_control?: unknown };

// Every cache_control in a request, wherever it sits.
const breakpoints = (body: unknown) => [...JSON.stringify(body).matchAll(/"cache_control":(\{[^}]*\})/g)].map((m) => JSON.parse(m[1]));

async function setup(usage: object = { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 2 }) {
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
  const threadId = await owner.mutation(api.chat.createThread, { providerId: anthropicId, modelId: "claude-sonnet-5-5" });
  fake = fakeFetch({
    [ANTHROPIC]: { body: sse(messageStart(usage), textDelta("ok"), messageDelta({ output_tokens: 2 }), messageStop) },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } }) + oaiDone },
  });
  const send = async (content: string, thread = threadId) => {
    await owner.mutation(api.chat.send, { threadId: thread, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  // Replies only: title side jobs (max_tokens 30) are filtered out.
  const replies = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30).map((r) => r.body as Body);
  return { t, owner, ownerId, threadId, openaiId, send, replies };
}

describe("cache-aware Anthropic requests", () => {
  test("the system prompt is one cached text block and automatic caching is on; no checkpoint, no second breakpoint", async () => {
    const s = await setup();
    await s.send("Hi");
    const [body] = s.replies();
    expect(body.system).toEqual([{ type: "text", text: SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION], cache_control: FIVE_MIN }]);
    expect(body.cache_control).toEqual(FIVE_MIN);
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
    expect(breakpoints(body)).toHaveLength(2); // system + top-level
  });

  test("with a checkpoint, the last block of the checkpoint layer carries the breakpoint", async () => {
    const s = await setup();
    // Two finished turns, the first user message pinned, then a checkpoint over both.
    const ids = await s.t.run(async (ctx) => {
      const out: Id<"messages">[] = [];
      for (const [role, content, pinned] of [["user", "U1", true], ["assistant", "A1", false], ["user", "U2", false], ["assistant", "A2", false]] as const) {
        out.push(
          await ctx.db.insert("messages", {
            ownerId: s.ownerId, threadId: s.threadId, parentId: out.at(-1), ancestorIds: [...out], role, content, pinned, status: "done",
          }),
        );
      }
      await ctx.db.insert("checkpoints", { ownerId: s.ownerId, threadId: s.threadId, coversUpToId: out[1], summary: "S", tokens: 1 });
      await ctx.db.patch("threads", s.threadId, { activeLeafId: out[3] });
      return out;
    });
    expect(ids).toHaveLength(4);
    await s.send("U3");
    const [body] = s.replies();
    expect(body.messages).toEqual([
      { role: "user", content: SUMMARY_PREFIX + "S" },
      { role: "user", content: [{ type: "text", text: "U1", cache_control: FIVE_MIN }] }, // last block of the layer: the pin
      { role: "user", content: "U2" },
      { role: "assistant", content: "A2" },
      { role: "user", content: "U3" },
    ]);
    const all = breakpoints(body);
    expect(all.length).toBeLessThanOrEqual(4);
    expect(all).toEqual([FIVE_MIN, FIVE_MIN, FIVE_MIN]); // one TTL for every breakpoint
  });

  test("two consecutive turns: the second request starts with the first one's bytes", async () => {
    const s = await setup();
    await s.send("First");
    await s.send("Second");
    const [one, two] = s.replies();
    expect(JSON.stringify(two.system)).toBe(JSON.stringify(one.system));
    const prefix = JSON.stringify(one.messages).slice(0, -1); // drop the closing bracket
    expect(JSON.stringify(two.messages).startsWith(prefix)).toBe(true);
    expect(two.messages.slice(one.messages.length)).toEqual([
      { role: "assistant", content: "ok" },
      { role: "user", content: "Second" },
    ]);
  });

  test("OpenAI-compatible requests carry no cache_control", async () => {
    const s = await setup();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.openaiId, modelId: "gpt-5" });
    await s.send("Hi", thread);
    const body = fake!.requests.find((r) => r.url.endsWith("/chat/completions"))!.body;
    expect(JSON.stringify(body)).not.toContain("cache_control");
  });

  test("title side jobs are unaffected", async () => {
    const s = await setup();
    await s.send("Hi");
    const title = fake!.requests.map((r) => r.body as Body).find((b) => b.max_tokens === 30)!;
    expect(title).toBeDefined();
    expect(typeof title.system).toBe("string");
    expect(breakpoints(title)).toEqual([]);
  });
});

describe("cache status", () => {
  const caching = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000, output_tokens: 2 };
  const status = async (s: Awaited<ReturnType<typeof setup>>, thread = s.threadId) =>
    (await s.owner.query(api.threadState.cache, { threadId: thread }))!.expiresAt;

  test("a never-touched thread is cold", async () => {
    const s = await setup(caching);
    expect(await status(s)).toBeNull();
    expect(cacheState(await status(s), Date.now())).toEqual({ state: "cold" });
  });

  test("a reply that wrote the cache makes it warm for 5 minutes from the request's start, then cold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000_000);
    const s = await setup(caching);
    await s.send("Hi");
    const expiresAt = (await status(s))!;
    expect(expiresAt).toBeCloseTo(10_000_000 + 5 * 60_000, -2); // counts from the start, give or take test-clock nudges
    expect(cacheState(expiresAt, 10_000_000 + 4 * 60_000)).toEqual({ state: "warm", until: expiresAt });
    expect(cacheState(expiresAt, expiresAt)).toEqual({ state: "cold" });
  });

  test("replies that report no cache reads or writes don't touch it, nor do OpenAI-compatible ones", async () => {
    const s = await setup(); // no reads, no writes
    await s.send("Hi");
    expect(await status(s)).toBeNull();
    const thread = await s.owner.mutation(api.chat.createThread, { providerId: s.openaiId, modelId: "gpt-5" });
    await s.send("Hi", thread); // reports 8 cached tokens, but tally.chat doesn't manage that cache
    expect(await status(s, thread)).toBeNull();
  });
});
