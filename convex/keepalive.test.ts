/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import { cacheState } from "./lib/cacheStatus";
import { CURRENT_SYSTEM_PROMPT_VERSION, SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";
const OPENAI = "POST https://api.openai.com/v1/chat/completions";
const MIN = 60_000;

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

type Body = { model: string; max_tokens: number; stream: boolean; system: unknown; messages: { role: string; content: unknown }[]; cache_control?: unknown };
const CACHING = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000, output_tokens: 1 };
const NO_CACHING = { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 1 };

async function setup(opts: { usage?: object; keepaliveStatus?: number } = {}) {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });

  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const base = { ownerId, apiKeyEncrypted, detected: "", keyCheckedAt: 0 };
  const providerId = await t.run((ctx) =>
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
  const tab1 = t.withIdentity({ subject: `${ownerId}|session1` });
  const tab2 = t.withIdentity({ subject: `${ownerId}|session2` });
  const threadId = await tab1.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  let replies = 0;
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (!body.stream) {
          if (opts.keepaliveStatus) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: opts.keepaliveStatus });
          return Response.json({ type: "message", content: [], usage: { input_tokens: 3, cache_read_input_tokens: 2000, output_tokens: 0 } });
        }
        replies += 1;
        const events = [messageStart(opts.usage ?? CACHING), textDelta(`R${replies}`), messageDelta({ output_tokens: 1 }), messageStop];
        return new Response(sse(...events));
      },
    },
    [OPENAI]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } }) + oaiDone },
  });

  // Runs every job that is due now; future ones stay scheduled. Steps 1 ms at a time because
  // convex-test schedules runAfter(0) a millisecond ahead.
  const settle = () => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
  const later = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await settle();
  };
  const send = async (content: string, thread = threadId) => {
    await tab1.mutation(api.chat.send, { threadId: thread, content });
    await settle();
  };
  const keepalives = () => fake!.requests.filter((r) => (r.body as Body).stream === false).map((r) => r.body as Body);
  const thread = () => tab1.query(api.chat.getThread, { threadId });
  const state = async () => {
    const th = (await thread())!;
    return cacheState(th.cacheExpiresAt, Date.now(), { scheduled: th.keepaliveScheduled, lastActiveAt: th.lastActiveAt }).state;
  };
  return { t, tab1, tab2, ownerId, threadId, openaiId, settle, later, send, keepalives, thread, state };
}

describe("keepalive", () => {
  test("with the owner active, fires 4.5 minutes after a reply with the same prefix, no output, then again", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    const reply = fake!.requests.find((r) => (r.body as Body).max_tokens === 8192)!.body as Body;
    expect(await s.state()).toBe("keepalive");

    await s.later(4.4 * MIN);
    expect(s.keepalives()).toHaveLength(0);
    await s.later(0.2 * MIN);
    const [first] = s.keepalives();
    expect(first).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 0, stream: false });
    expect(first.system).toEqual(reply.system);
    expect(first.cache_control).toEqual(reply.cache_control);
    // The breakpoint sits on the latest reply, so the cached prefix is exactly what the next turn
    // shares. 5.5 models reject a conversation ending on an assistant message (no prefill), so
    // a one-character user message follows it; with max_tokens 0 nothing is generated.
    expect(first.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: [{ type: "text", text: "R1", cache_control: { type: "ephemeral", ttl: "5m" } }] },
      { role: "user", content: "." },
    ]);
    expect((first.system as { text: string }[])[0].text).toBe(SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION]);

    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(2);
    expect(await s.state()).toBe("keepalive");
  });

  test("keepalives are side jobs of kind keepalive, metered into the rollups", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    await s.later(4.5 * MIN);
    const jobs = await s.t.run((ctx) => ctx.db.query("sideJobs").collect());
    expect(jobs.filter((j) => j.kind === "keepalive")).toMatchObject([{ threadId: s.threadId, usage: { cacheReadTokens: 2000, outputTokens: 0 } }]);
    const byThread = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    const row = byThread.find((r) => r.dimension === "thread" && r.key === s.threadId)!;
    expect(row.cacheReadTokens).toBe(2000); // the reply read nothing; the keepalive's read is in the rollup
  });

  test("stop 30 minutes after the owner's last activity", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    for (let i = 0; i < 8; i++) await s.later(4.5 * MIN); // 36 minutes
    expect(s.keepalives()).toHaveLength(6); // 4.5, 9, ..., 27; at 31.5 the owner is gone
    expect((await s.thread())!.keepaliveScheduled).toBe(false);
    expect(await s.state()).toBe("cold"); // the last keepalive's 5 minutes ran out at 32
  });

  test("never without presence, for a provider that reported no caching, or for OpenAI-compatible threads", async () => {
    const quiet = await setup();
    await quiet.send("Hi"); // owner never marked active
    await quiet.later(10 * MIN);
    expect(quiet.keepalives()).toHaveLength(0);

    const uncached = await setup({ usage: NO_CACHING });
    await uncached.tab1.mutation(api.chat.markActive, { threadId: uncached.threadId });
    await uncached.send("Hi");
    expect((await uncached.thread())!.keepaliveScheduled).toBe(false);
    await uncached.later(10 * MIN);
    expect(uncached.keepalives()).toHaveLength(0);

    const s = await setup();
    const thread = await s.tab1.mutation(api.chat.createThread, { providerId: s.openaiId, modelId: "gpt-5" });
    await s.tab1.mutation(api.chat.markActive, { threadId: thread });
    await s.send("Hi", thread);
    await s.later(10 * MIN);
    expect(s.keepalives()).toHaveLength(0);
  });

  test("never once the cache already expired", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    // Pretend the touch was long ago (e.g. the job was delayed): a keepalive would pay a cold write.
    await s.t.run((ctx) => ctx.db.patch("threads", s.threadId, { cacheTouchedAt: Date.now() - 6 * MIN }));
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(0);
  });

  test("never while a reply is streaming; that reply restarts the cycle when it finishes", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("One");
    // A second reply is mid-stream when the first reply's keepalive comes due.
    const streaming = await s.t.run(async (ctx) => {
      const thread = (await ctx.db.get("threads", s.threadId))!;
      const leaf = (await ctx.db.get("messages", thread.activeLeafId!))!;
      const base = { ownerId: s.ownerId, threadId: s.threadId, pinned: false };
      const user = await ctx.db.insert("messages", {
        ...base, parentId: leaf._id, ancestorIds: [...leaf.ancestorIds, leaf._id], role: "user", content: "Two", status: "done",
      });
      const reply = await ctx.db.insert("messages", {
        ...base, parentId: user, ancestorIds: [...leaf.ancestorIds, leaf._id, user], role: "assistant", content: "", status: "streaming",
        model: "claude-sonnet-5-5", providerId: thread.providerId,
      });
      await ctx.db.patch("threads", s.threadId, { activeLeafId: reply });
      return reply;
    });
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(0);

    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.t.mutation(internal.chat.finalize, {
      messageId: streaming, status: "done", content: "R2", pending: "",
      usage: { inputTokens: 5, cacheReadTokens: 2000, cacheWriteTokens5m: 0, cacheWriteTokens1h: 0, outputTokens: 1, reasoningTokens: 0 },
      cacheRequest: { startedAt: Date.now(), ttl: "5m" },
    });
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(1);
  });

  test("a new reply cancels the pending keepalive and schedules a fresh one", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("One");
    await s.later(3 * MIN);
    await s.send("Two"); // keepalive now due at 3 + 4.5 minutes
    await s.later(2 * MIN); // 5 minutes: the first reply's job would have fired at 4.5
    expect(s.keepalives()).toHaveLength(0);
    await s.later(2.5 * MIN);
    expect(s.keepalives()).toHaveLength(1);
    expect(s.keepalives()[0].messages.slice(0, 4).map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]); // covers the latest reply
  });

  test("two tabs marking activity still get one keepalive per window", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    for (let i = 0; i < 4; i++) {
      await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
      await s.tab2.mutation(api.chat.markActive, { threadId: s.threadId });
      await s.later(MIN);
    }
    await s.later(0.5 * MIN);
    expect(s.keepalives()).toHaveLength(1);
  });

  test("a failed keepalive stops quietly; the thread and its next turn are unaffected", async () => {
    const s = await setup({ keepaliveStatus: 500 });
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    const before = (await s.thread())!.cacheExpiresAt;
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(1);
    const after = (await s.thread())!;
    expect(after.cacheExpiresAt).toBe(before);
    expect(after.keepaliveScheduled).toBe(false);
    expect(await s.t.run((ctx) => ctx.db.query("sideJobs").collect())).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: "keepalive" })]),
    );
    await s.later(10 * MIN);
    expect(s.keepalives()).toHaveLength(1); // nothing further scheduled

    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Again");
    expect((await s.thread())!.messages.at(-1)!.status).toBe("done");
    expect((await s.thread())!.keepaliveScheduled).toBe(true); // the next reply restarted the cycle
  });

  test("a deleted thread stops its keepalive and the purge removes keepalive side jobs", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hi");
    await s.later(4.5 * MIN); // one keepalive recorded
    await s.tab1.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.later(10 * MIN);
    expect(s.keepalives()).toHaveLength(1);
    expect(await s.t.run((ctx) => ctx.db.query("sideJobs").collect())).toEqual([]);
  });
});

describe("keepalive switch and the 1-hour fallback", () => {
  const breakpoints = (body: unknown) => [...JSON.stringify(body).matchAll(/"cache_control":(\{[^}]*\})/g)].map((m) => JSON.parse(m[1]));
  const replyBodies = () => fake!.requests.map((r) => r.body as Body).filter((b) => b.max_tokens === 8192);

  test("off: no keepalives, and from the second turn every breakpoint uses the 1-hour lifetime", async () => {
    const s = await setup();
    await s.tab1.mutation(api.settings.setKeepaliveEnabled, { enabled: false });
    expect((await s.tab1.query(api.settings.get, {})).keepaliveEnabled).toBe(false);
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("One");
    await s.send("Two");
    const [first, second] = replyBodies();
    expect(new Set(breakpoints(first).map((b) => b.ttl))).toEqual(new Set(["5m"]));
    expect(breakpoints(second).map((b) => b.ttl)).toEqual(["1h", "1h"]);

    const thread = (await s.thread())!;
    expect(thread.keepaliveScheduled).toBe(false);
    expect(thread.cacheExpiresAt! - Date.now()).toBeGreaterThan(55 * MIN); // the status uses the hour
    await s.later(10 * MIN);
    expect(s.keepalives()).toHaveLength(0);
    expect(await s.state()).toBe("warm");
  });

  test("on (the default): requests stay on 5 minutes", async () => {
    const s = await setup();
    expect((await s.tab1.query(api.settings.get, {})).keepaliveEnabled).toBe(true);
    await s.send("One");
    await s.send("Two");
    for (const body of replyBodies()) expect(new Set(breakpoints(body).map((b) => b.ttl))).toEqual(new Set(["5m"]));
  });

  test("turning it off stops a pending keepalive at its next firing; back on, it resumes after the next reply", async () => {
    const s = await setup();
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("One");
    await s.tab1.mutation(api.settings.setKeepaliveEnabled, { enabled: false });
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(0);

    await s.tab1.mutation(api.settings.setKeepaliveEnabled, { enabled: true });
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(0); // nothing resumes on its own
    await s.tab1.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Two");
    await s.later(4.5 * MIN);
    expect(s.keepalives()).toHaveLength(1);
  });
});
