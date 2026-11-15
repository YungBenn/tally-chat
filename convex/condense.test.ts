/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { paybackTurns, planFold } from "./lib/condense";
import { SUMMARY_PREFIX } from "./lib/context";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
// A priced model with a 1,000-token context window, for the context-window override.
vi.mock("./lib/usage", async (original) => {
  const actual = await original<typeof import("./lib/usage")>();
  return {
    ...actual,
    priceFor: (model: string, ...rest: Parameters<typeof actual.priceFor> extends [string, ...infer R] ? R : never) =>
      model === "claude-tiny" ? { ...actual.priceFor("claude-sonnet-5-5"), contextWindow: 1000 } : actual.priceFor(model, ...rest),
  };
});
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Block = { type: string; text: string; cache_control?: object };
type Body = {
  model: string;
  max_tokens: number;
  system: string | Block[];
  messages: { role: string; content: string | Block[] }[];
};
const systemText = (b: Body) => (typeof b.system === "string" ? b.system : b.system.map((x) => x.text).join(""));
const text = (c: string | Block[]) => (typeof c === "string" ? c : c.map((b) => b.text).join(""));
const isSummaryCall = (b: Body) => systemText(b).startsWith("You condense a chat");
const isTitleCall = (b: Body) => b.max_tokens === 30;

// A fake Anthropic API whose usage grows with the request (characters / 4), so the inspector's
// measured layer sizes behave like the real thing. Summary calls answer `summary` (or fail).
function provider(summary: () => string | "fail" | "truncate", { caching = true } = {}) {
  let n = 0;
  return {
    respond: (init: RequestInit | undefined) => {
      const body = JSON.parse(String(init?.body)) as Body;
      const input = Math.ceil(String(init?.body).length / 4);
      if (isSummaryCall(body)) {
        const s = summary();
        if (s === "fail") return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 });
        const stop = s === "truncate" ? "max_tokens" : "end_turn";
        return new Response(
          sse(
            messageStart({ input_tokens: input, output_tokens: 1 }),
            textDelta(s === "truncate" ? "Partial summ" : s),
            `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } })}\n\n`,
            messageStop,
          ),
        );
      }
      // Replies and keepalives write the whole request to the cache, as a real cached prefix would.
      const usage = caching
        ? { input_tokens: 5, cache_creation_input_tokens: Math.max(0, input - 5), output_tokens: 1 }
        : { input_tokens: input, output_tokens: 1 };
      if (body.max_tokens === 0) return Response.json({ type: "message", content: [], usage: { ...usage, output_tokens: 0 } });
      const reply = isTitleCall(body) ? "A title" : `Answer ${++n}`;
      return new Response(sse(messageStart(usage), textDelta(reply), messageDelta({ output_tokens: 3 }), messageStop));
    },
  };
}

const LONG = "x".repeat(400); // ~100 tokens per user message

async function setup(condense: Partial<Doc<"settings">> = {}, { modelId = "claude-sonnet-5-5", free = false } = {}) {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "Anthropic", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted, detected: "", keyCheckedAt: 0,
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
        { id: "claude-haiku-5-5", displayName: "Haiku", hidden: false },
        { id: "claude-tiny", displayName: "Tiny", hidden: false },
      ],
      free,
    }),
  );
  // Small thresholds so a few turns cross them: condense past 500 tokens of turns, keep 2 turns.
  // The cache veto is out of the way unless a test sets its own payback limit.
  const settingsId = await t.run((ctx) =>
    ctx.db.insert("settings", {
      ownerId, allowlistedHosts: [],
      condenseAtTokens: 500, condenseMinThreadTokens: 200, condenseKeepTurns: 2, condensePaybackTurns: 1e9, ...condense,
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId });
  const chat = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const setCondense = (fields: Partial<Doc<"settings">>) => t.run((ctx) => ctx.db.patch("settings", settingsId, fields));
  const bodies = () => fake!.requests.filter((r) => r.url.endsWith("/v1/messages")).map((r) => r.body as Body);
  const summaryCalls = () => bodies().filter(isSummaryCall);
  const replyCalls = () => bodies().filter((b) => !isSummaryCall(b) && !isTitleCall(b) && b.max_tokens !== 0);
  const keepaliveCalls = () => bodies().filter((b) => b.max_tokens === 0);
  const checkpoints = () => t.run((ctx) => ctx.db.query("checkpoints").collect());
  const inspector = () => owner.query(api.inspector.get, { threadId });
  return { t, owner, ownerId, threadId, chat, setCondense, summaryCalls, replyCalls, keepaliveCalls, checkpoints, inspector };
}

// Builds `turns` turns with condensing off, then turns it back on: the next reply triggers one check.
async function longThread(s: Awaited<ReturnType<typeof setup>>, turns: number) {
  await s.setCondense({ condenseEnabled: false });
  for (let i = 1; i <= turns; i++) await s.chat(`Turn ${i} ${LONG}`);
  await s.setCondense({ condenseEnabled: true });
}

describe("condensing after a reply", () => {
  test("a thread past the threshold folds all but the kept turns into a checkpoint, used from the next send", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    expect(s.summaryCalls()).toHaveLength(0);

    await s.chat(`Turn 6 ${LONG}`); // 6 turns, keep 2: turns 1 to 4 fold
    const [call] = s.summaryCalls();
    expect(call.model).toBe("claude-haiku-5-5"); // the side-job model, not the thread's
    const request = text(call.messages[0].content);
    expect(request).toContain("User: Turn 1");
    expect(request).toContain("Assistant: Answer 4");
    expect(request).not.toContain("Turn 5");
    expect(request).not.toContain("Earlier summary");

    const [checkpoint] = await s.checkpoints();
    expect(checkpoint.summary).toBe("Summary one");
    expect(checkpoint.tokens).toBe(40); // the summary's measured output tokens

    await s.chat("Turn 7");
    const next = s.replyCalls().at(-1)!;
    expect(next.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: `${SUMMARY_PREFIX}Summary one`, cache_control: { type: "ephemeral", ttl: "5m" } }],
    });
    // Summary, then turns 5 and 6 verbatim, then the new message.
    expect(next.messages.slice(1).map((m) => text(m.content).slice(0, 6))).toEqual(["Turn 5", "Answer", "Turn 6", "Answer", "Turn 7"]);

    // The thread view folds the covered messages behind the summary.
    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!;
    expect(view.checkpoint).toEqual({ coveredCount: 8, turns: 4, summary: "Summary one" });
    expect(view.messages).toHaveLength(14); // every message is still there to expand

    const inspector = await s.inspector();
    expect(inspector!.layers.find((l) => l.kind === "checkpoint")!.label).toBe("summary of turns\u00a01\u2060–\u20604");
  });

  test("short threads, threads under the threshold and threads with only the kept turns don't condense", async () => {
    const tiny = await setup({ condenseAtTokens: undefined, condenseMinThreadTokens: undefined, condenseKeepTurns: undefined });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    for (let i = 1; i <= 4; i++) await tiny.chat(`Turn ${i} ${LONG}`); // defaults: 30k threshold, 10k minimum
    expect(tiny.summaryCalls()).toHaveLength(0);
    const status = (await tiny.inspector())!.condense;
    expect(status.state).toBe("waiting");
    expect(status.inTokens).toBeGreaterThan(20_000);
    fake.restore();

    const kept = await setup({ condenseKeepTurns: 6 });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    for (let i = 1; i <= 6; i++) await kept.chat(`Turn ${i} ${LONG}`); // over the threshold, but every turn is kept
    expect(kept.summaryCalls()).toHaveLength(0);
  });

  test("a second condense rolls the previous summary in, and only the newest checkpoint applies", async () => {
    const s = await setup();
    let n = 0;
    fake = fakeFetch({ [ANTHROPIC]: provider(() => `Summary ${++n}`) });
    await longThread(s, 5);
    await s.chat(`Turn 6 ${LONG}`);
    await s.setCondense({ condenseEnabled: false });
    for (let i = 7; i <= 10; i++) await s.chat(`Turn ${i} ${LONG}`);
    await s.setCondense({ condenseEnabled: true });
    await s.chat(`Turn 11 ${LONG}`);

    const second = text(s.summaryCalls()[1].messages[0].content);
    expect(second).toContain("Earlier summary:\n\nSummary 1");
    expect(second).toContain("User: Turn 5");
    expect(second).not.toContain("Turn 1 "); // covered by the earlier summary, not re-sent

    await s.chat("Turn 12");
    const next = s.replyCalls().at(-1)!;
    expect(text(next.messages[0].content)).toBe(`${SUMMARY_PREFIX}Summary 2`);
    expect(next.messages.filter((m) => text(m.content).startsWith(SUMMARY_PREFIX))).toHaveLength(1);
  });

  test("a failed or cut-off summary writes no checkpoint, shows in the inspector, and the next reply retries", async () => {
    const s = await setup();
    const answers: ("fail" | "truncate" | string)[] = ["fail", "truncate", "Recovered summary"];
    fake = fakeFetch({ [ANTHROPIC]: provider(() => answers.shift()!) });
    await longThread(s, 5);

    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(0);
    let status = (await s.inspector())!.condense;
    expect(status.state).toBe("failed");
    expect(status.failure).toContain("Provider error 529");

    await s.chat(`Turn 7 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(0);
    expect((await s.inspector())!.condense.failure).toBe("the summary was cut off");

    await s.chat(`Turn 8 ${LONG}`);
    expect((await s.checkpoints()).map((c) => c.summary)).toEqual(["Recovered summary"]);
    status = (await s.inspector())!.condense;
    expect(status.state).toBe("waiting");
    expect(status.failure).toBeUndefined();
  });

  test("an edit inside the condensed range forks to a branch without the summary", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.chat(`Turn 6 ${LONG}`);
    await s.setCondense({ condenseEnabled: false });

    const first = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages[0];
    await s.owner.mutation(api.chat.edit, { messageId: first._id, content: "Turn 1, edited" });
    await s.t.finishAllScheduledFunctions(() => {});
    const forked = s.replyCalls().at(-1)!;
    expect(forked.messages.map((m) => text(m.content))).toEqual(["Turn 1, edited"]);
    expect((await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.checkpoint).toBeNull(); // no fold on this branch
  });

  test("the condense is metered as a side job and counted in the thread total, but not in the replies' hit rate", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const before = (await s.inspector())!.thread;
    await s.chat(`Turn 6 ${LONG}`);

    const jobs = await s.t.run((ctx) => ctx.db.query("sideJobs").collect());
    const condense = jobs.filter((j) => j.kind === "condense");
    expect(condense).toHaveLength(1);
    expect(condense[0]).toMatchObject({ model: "claude-haiku-5-5", usage: { outputTokens: 40 } });
    const reply = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    const after = (await s.inspector())!.thread;
    expect(after.costMicroUsd - before.costMicroUsd).toBe((reply.costMicroUsd ?? 0) + condense[0].costMicroUsd!);
    const rows = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(rows.some((r) => r.dimension === "model" && r.key === "claude-haiku-5-5")).toBe(true);
    expect(rows.some((r) => r.dimension === "upkeep")).toBe(false);

    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(await s.checkpoints()).toHaveLength(0);
  });

  test("at most one condense is queued or running per thread", async () => {
    const s = await setup();
    const thread = await s.t.run((ctx) => ctx.db.get("threads", s.threadId));
    await s.t.run(async (ctx) => {
      const { scheduleCondense } = await import("./condense");
      await scheduleCondense(ctx, thread!);
      await scheduleCondense(ctx, (await ctx.db.get("threads", s.threadId))!);
    });
    const jobs = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((j) => j.name.includes("condense"))).toHaveLength(1);
    expect((await s.inspector())!.condense.state).toBe("condensing");
  });

  test("condensing off stops automatic condensing", async () => {
    const s = await setup({ condenseEnabled: false });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    for (let i = 1; i <= 6; i++) await s.chat(`Turn ${i} ${LONG}`);
    expect(s.summaryCalls()).toHaveLength(0);
    expect((await s.inspector())!.condense.state).toBe("off");
  });
});

describe("after a checkpoint lands", () => {
  test("the cache reads cold, and with the owner active a keepalive writes the new prefix right away", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.chat(`Turn 6 ${LONG}`);

    const warm = s.keepaliveCalls().at(-1)!;
    expect(warm.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: `${SUMMARY_PREFIX}Summary one`, cache_control: { type: "ephemeral", ttl: "5m" } }],
    });
    // The kept turns, the latest reply marked as the breakpoint the next turn will share, then the nudge.
    expect(warm.messages.slice(1).map((m) => text(m.content).slice(0, 6))).toEqual(["Turn 5", "Answer", "Turn 6", "Answer", "."]);
    const rows = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(rows.some((r) => r.dimension === "upkeep")).toBe(true);
    const thread = await s.t.run((ctx) => ctx.db.get("threads", s.threadId));
    expect(thread!.cacheTouchedAt).toBeDefined(); // the warm keepalive touched the new prefix
  });

  test("with the owner away, nothing is sent and the next send pays the write", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const before = s.keepaliveCalls().length;
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
    expect(s.keepaliveCalls()).toHaveLength(before);
    const thread = await s.t.run((ctx) => ctx.db.get("threads", s.threadId));
    expect(thread!.cacheTouchedAt).toBeUndefined();
    expect((await s.inspector())!.cache.expiresAt).toBeNull(); // cold: the cost strip prices a write
  });

  test("keepalive turned off means no warm-up either", async () => {
    const s = await setup({ keepaliveEnabled: false });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
    expect(s.keepaliveCalls()).toHaveLength(0);
  });
});

describe("the cache veto", () => {
  test("payback: a cached thread needs several turns to recover a condense, an uncached one less than one", () => {
    // 30k tokens folded out of a 36k prefix on Sonnet 5.5, summarized by Haiku 5.5.
    const sonnet = { input: 2e-6, cacheRead: 1e-7, cacheWrite: 2.5e-6 };
    const haiku = { input: 1e-7, output: 5e-7 };
    const fold = { oldPrefixTokens: 36_000, summaryInputTokens: 30_000, summaryTokens: 2048, removedTokens: 30_000 - 2048, thread: sonnet, side: haiku };
    const cached = paybackTurns({ ...fold, caching: true })!;
    expect(cached).toBeGreaterThan(5);
    expect(cached).toBeLessThan(10);
    expect(paybackTurns({ ...fold, caching: false })!).toBeLessThan(1);
    expect(paybackTurns({ ...fold, caching: true, thread: null })).toBeNull(); // unpriced: the veto doesn't apply
    expect(paybackTurns({ ...fold, caching: true, thread: { input: 0, cacheRead: 0, cacheWrite: 0 } })).toBeNull(); // free
    expect(paybackTurns({ ...fold, caching: true, removedTokens: 0 })).toBe(Infinity);
  });

  test("holds a condense on a cached thread that pays back too slowly, and the inspector says why", async () => {
    const s = await setup({ condensePaybackTurns: 0.01 });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    await longThread(s, 5);
    await s.chat(`Turn 6 ${LONG}`);
    expect(s.summaryCalls()).toHaveLength(0);
    const status = (await s.inspector())!.condense;
    expect(status.state).toBe("held");
    expect(status.paybackTurns).toBeGreaterThan(0.01);
  });

  test("lets it through on a provider that doesn't cache", async () => {
    const s = await setup({ condensePaybackTurns: 1 });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one", { caching: false }) });
    await longThread(s, 5);
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
  });

  test("doesn't apply on a free provider: the thresholds alone decide", async () => {
    const s = await setup({ condensePaybackTurns: 0.01 }, { free: true });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
  });

  test("a thread at half the model's context window condenses even when the veto would hold it", async () => {
    const s = await setup({ condensePaybackTurns: 0.01 }, { modelId: "claude-tiny" });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5); // about 650 tokens: past half of claude-tiny's 1,000
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
  });
});

describe("planFold", () => {
  const msg = (role: "user" | "assistant", status: Doc<"messages">["status"] = "done") =>
    ({ _id: `${role}${Math.random()}` as Id<"messages">, role, status, content: "x", pinned: false }) as Doc<"messages">;
  const turns = (...statuses: Doc<"messages">["status"][]) => statuses.flatMap((s) => [msg("user"), msg("assistant", s)]);

  test("folds whole turns up to the kept ones", () => {
    expect(planFold(turns("done", "done", "done", "done"), 0, 2)).toBe(3); // ends on turn 2's reply
    expect(planFold(turns("done", "done"), 0, 2)).toBeNull();
    expect(planFold(turns("done", "done", "done", "done"), 4, 1)).toBe(5); // starts after a checkpoint
  });

  test("never ends the fold on a stopped, errored or streaming reply", () => {
    expect(planFold(turns("done", "error", "done", "done"), 0, 2)).toBe(1);
    expect(planFold(turns("stopped", "done", "done"), 0, 2)).toBeNull();
    expect(planFold(turns("done", "done", "streaming"), 0, 1)).toBe(3);
  });
});
