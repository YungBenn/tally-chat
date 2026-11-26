/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { untagged } from "../test/untagged";
import { messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { paybackTurns, planFold } from "./lib/condense";
import { SUMMARY_PREFIX } from "./lib/context";
import { SUMMARY_MAX_TOKENS, SUMMARY_PROMPTS } from "./lib/condense";
import { encryptSecret } from "./lib/vault";
import { threadState } from "./threadState";
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
  output_config?: unknown;
  system: string | Block[];
  messages: { role: string; content: string | Block[] }[];
};
const systemText = (b: Body) => (typeof b.system === "string" ? b.system : b.system.map((x) => x.text).join(""));
const text = (c: string | Block[]) => untagged(typeof c === "string" ? c : c.map((b) => b.text).join(""));
const isSummaryCall = (b: Body) => systemText(b).startsWith("You condense a chat");
const isTitleCall = (b: Body) => b.max_tokens === 512;

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
    expect(call.model).toBe("claude-sonnet-5-5"); // the thread's own model, not the side-job one
    expect(call.output_config).toBeUndefined(); // the model's API default effort
    // No effort field to keep thinking short, so the request leaves room for it above the summary's 6,000.
    expect(call.max_tokens).toBe(16_000);
    expect(systemText(call)).toBe(SUMMARY_PROMPTS[2]);
    expect(SUMMARY_MAX_TOKENS).toBe(6000);
    const request = text(call.messages[0].content);
    expect(request).toContain("User: Turn 1");
    expect(request).toContain("Assistant: Answer 4");
    expect(request).not.toContain("Turn 5");
    expect(request).not.toContain("Earlier summary");

    const [checkpoint] = await s.checkpoints();
    expect(checkpoint.summary).toBe("Summary one");
    expect(checkpoint.tokens).toBe(40); // the summary's measured output tokens
    expect(checkpoint.promptVersion).toBe(2);

    await s.chat("Turn 7");
    const next = s.replyCalls().at(-1)!;
    expect(next.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: `${SUMMARY_PREFIX}<summary>\nSummary one\n</summary>`, cache_control: { type: "ephemeral", ttl: "5m" } }],
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

  test("a version 1 checkpoint keeps its bytes: the summary is sent bare, without tags", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    await longThread(s, 5);
    await s.setCondense({ condenseEnabled: false });
    await s.chat("Turn 6");
    const last = await s.t.run((ctx) => ctx.db.query("messages").order("desc").first());
    await s.t.run((ctx) =>
      ctx.db.insert("checkpoints", { ownerId: s.ownerId, threadId: s.threadId, coversUpToId: last!._id, summary: "Old summary", tokens: 3 }),
    );
    await s.chat("Turn 7");
    expect(text(s.replyCalls().at(-1)!.messages[0].content)).toBe(`${SUMMARY_PREFIX}Old summary`);
  });

  test("short threads, threads under the threshold and threads with only the kept turns don't condense", async () => {
    const tiny = await setup({ condenseAtTokens: undefined, condenseMinThreadTokens: undefined, condenseKeepTurns: undefined });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    for (let i = 1; i <= 4; i++) await tiny.chat(`Turn ${i} ${LONG}`); // defaults: 80k threshold, 10k minimum
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
    expect(text(next.messages[0].content)).toBe(`${SUMMARY_PREFIX}<summary>\nSummary 2\n</summary>`);
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
    expect(condense[0]).toMatchObject({ model: "claude-sonnet-5-5", usage: { outputTokens: 40 } });
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
    await s.t.finishAllScheduledFunctions(() => {}); // don't leave the job to run during the next test
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
  test("the inspector stops measuring from a reply sent before the checkpoint", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const before = (await s.inspector())!.layers.find((l) => l.kind === "turns")!;
    await s.chat(`Turn 6 ${LONG}`); // condenses turns 1 to 4 after this reply
    const turns = (await s.inspector())!.layers.find((l) => l.kind === "turns")!;
    // That reply's usage covered all six turns; only turns 5 and 6 remain verbatim.
    expect(turns.label).toBe("turns 5–6");
    expect(turns.estimated).toBe(true);
    expect(turns.tokens).toBeLessThan(before.tokens / 2);
  });

  test("edit hints after a condense price only what follows the summary", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    const HUGE = "y".repeat(20_000); // ~5k tokens a turn, so a stale measurement would make a hint
    await s.setCondense({ condenseEnabled: false });
    for (let i = 1; i <= 5; i++) await s.chat(`Turn ${i} ${HUGE}`);
    await s.setCondense({ condenseEnabled: true });
    await s.chat(`Turn 6 ${HUGE}`); // condenses turns 1 to 4

    const messages = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages;
    const hints = (await s.inspector())!.editHints;
    // Editing turn 5 keeps the summary layer cached and rewrites nothing before turn 5: no hint.
    expect(hints.find((h) => h.messageId === messages[8]._id)).toBeUndefined();
    // Editing turn 6 rewrites turn 5 (~5k tokens): a hint, but not one priced off the folded turns.
    const turn6 = hints.find((h) => h.messageId === messages[10]._id)!;
    expect(turn6.extraMicroUsd).toBeGreaterThan(0);
    expect(turn6.extraMicroUsd).toBeLessThan(20_000); // ~5k tokens written at $2.50/M, not ~25k
  });

  test("the cache reads cold, and with the owner active a keepalive writes the new prefix right away", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.chat(`Turn 6 ${LONG}`);

    const warm = s.keepaliveCalls().at(-1)!;
    expect(warm.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: `${SUMMARY_PREFIX}<summary>\nSummary one\n</summary>`, cache_control: { type: "ephemeral", ttl: "5m" } }],
    });
    // The kept turns, the latest reply marked as the breakpoint the next turn will share, then the nudge.
    expect(warm.messages.slice(1).map((m) => text(m.content).slice(0, 6))).toEqual(["Turn 5", "Answer", "Turn 6", "Answer", "."]);
    const rows = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(rows.some((r) => r.dimension === "upkeep")).toBe(true);
    const state = await s.t.run((ctx) => threadState(ctx, s.threadId));
    expect(state?.cacheTouchedAt).toBeDefined(); // the warm keepalive touched the new prefix
  });

  test("with the owner away, nothing is sent and the next send pays the write", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const before = s.keepaliveCalls().length;
    await s.chat(`Turn 6 ${LONG}`);
    expect(await s.checkpoints()).toHaveLength(1);
    expect(s.keepaliveCalls()).toHaveLength(before);
    const state = await s.t.run((ctx) => threadState(ctx, s.threadId));
    expect(state?.cacheTouchedAt).toBeUndefined();
    expect((await s.owner.query(api.threadState.cache, { threadId: s.threadId }))!.expiresAt).toBeNull(); // cold: the cost strip prices a write
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

describe("pinned messages", () => {
  test("a pinned message stays out of the summary and is sent verbatim after it, in order", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const [, firstReply, secondUser] = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages;
    await s.owner.mutation(api.condense.setPinned, { messageId: secondUser._id, pinned: true });
    await s.owner.mutation(api.condense.setPinned, { messageId: firstReply._id, pinned: true });
    await s.chat(`Turn 6 ${LONG}`);

    const request = text(s.summaryCalls()[0].messages[0].content);
    expect(request).toContain("User: Turn 1");
    expect(request).not.toContain("Answer 1");
    expect(request).not.toContain("Turn 2");

    await s.chat("Turn 7");
    const next = s.replyCalls().at(-1)!;
    // Summary, then the covered pins in their original order (with the layer breakpoint on the last
    // one), then the kept turns.
    expect(next.messages.slice(0, 3).map((m) => text(m.content).slice(0, 8))).toEqual(["Summary ", "Answer 1", "Turn 2 x"]);
    expect((next.messages[2].content as Block[])[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });

    const view = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!;
    expect(view.messages.filter((m) => m.pinned).map((m) => m._id)).toEqual([firstReply._id, secondUser._id]);
    expect(view.messages.slice(0, 8).every((m) => m.pinLocked)).toBe(true);
    expect(view.messages.slice(8).some((m) => m.pinLocked)).toBe(false);
    const label = (await s.inspector())!.layers.find((l) => l.kind === "checkpoint")!.label;
    expect(label).toContain("+ 2\u00a0pinned");
  });

  test("pins can change until a checkpoint covers the message, then they're fixed", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    const [first] = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages;
    await s.owner.mutation(api.condense.setPinned, { messageId: first._id, pinned: true });
    await s.owner.mutation(api.condense.setPinned, { messageId: first._id, pinned: false }); // a mistake, corrected
    await s.chat(`Turn 6 ${LONG}`);
    await expect(s.owner.mutation(api.condense.setPinned, { messageId: first._id, pinned: true })).rejects.toThrow(
      "already condensed",
    );
    const kept = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    await s.owner.mutation(api.condense.setPinned, { messageId: kept._id, pinned: true }); // not covered: fine
  });

  test("pinning a recent message doesn't change what the next request sends", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    await s.chat("Hello");
    const [user, reply] = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages;
    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.t.finishAllScheduledFunctions(() => {});
    const before = JSON.stringify(s.replyCalls().at(-1)!.messages);
    await s.owner.mutation(api.condense.setPinned, { messageId: user._id, pinned: true });
    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(JSON.stringify(s.replyCalls().at(-1)!.messages)).toBe(before);
  });
});

describe("condense now", () => {
  test("runs below the threshold, despite the veto and with condensing off, and keeps the recent turns", async () => {
    const s = await setup({ condenseEnabled: false, condenseAtTokens: 1e9, condensePaybackTurns: 0.01 });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Manual summary") });
    for (let i = 1; i <= 4; i++) await s.chat(`Turn ${i} ${LONG}`);
    expect(s.summaryCalls()).toHaveLength(0);

    const estimate = (await s.inspector())!.condenseNow!;
    expect(estimate.costMicroUsd).toBeGreaterThan(0);
    expect(estimate.paybackTurns).toBeGreaterThan(0);

    await s.owner.mutation(api.condense.condenseNow, { threadId: s.threadId });
    await s.t.finishAllScheduledFunctions(() => {});
    const request = text(s.summaryCalls()[0].messages[0].content);
    expect(request).toContain("Turn 2");
    expect(request).not.toContain("Turn 3"); // keep 2: turns 3 and 4 stay verbatim
    expect((await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.checkpoint).toMatchObject({ turns: 2, summary: "Manual summary" });
  });

  test("is unavailable when only the kept turns remain, and can't be queued twice", async () => {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "unused") });
    await s.setCondense({ condenseEnabled: false });
    await s.chat(`Turn 1 ${LONG}`);
    await s.chat(`Turn 2 ${LONG}`);
    expect((await s.inspector())!.condenseNow).toBeNull();
    await expect(s.owner.mutation(api.condense.condenseNow, { threadId: s.threadId })).rejects.toThrow("Nothing to condense yet");

    await s.chat(`Turn 3 ${LONG}`);
    await s.owner.mutation(api.condense.condenseNow, { threadId: s.threadId });
    await expect(s.owner.mutation(api.condense.condenseNow, { threadId: s.threadId })).rejects.toThrow("already condensing");
    await s.t.finishAllScheduledFunctions(() => {}); // don't leave the job to run during the next test
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
    const s = await setup({ condensePaybackTurns: 5 }); // the summary is priced on the thread's model
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

describe("the folded transcript", () => {
  // A 5-turn thread with condensing off; `decorate` edits the stored messages before the fold.
  async function folded(decorate: (ctx: MutationCtx, users: Doc<"messages">[], replies: Doc<"messages">[], s: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
    const s = await setup();
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    await longThread(s, 5);
    await s.t.run(async (ctx) => {
      const all = await ctx.db.query("messages").collect();
      await decorate(ctx, all.filter((m) => m.role === "user"), all.filter((m) => m.role === "assistant"), s);
    });
    await s.chat(`Turn 6 ${LONG}`);
    return text(s.summaryCalls()[0].messages[0].content);
  }

  test("each folded document is named with its first 500 characters", async () => {
    const request = await folded(async (ctx, users, _r, s) => {
      const [u1, u5] = [users[0], users[4]];
      const id = await ctx.db.insert("documents", { ownerId: s.ownerId, name: "spec.md", text: "d".repeat(500) + "TAIL", tokens: 1 });
      const late = await ctx.db.insert("documents", { ownerId: s.ownerId, name: "late.md", text: "kept", tokens: 1 });
      await ctx.db.patch("messages", u1._id, { documents: [{ id, name: "spec.md", tokens: 1 }] });
      await ctx.db.patch("messages", u5._id, { documents: [{ id: late, name: "late.md", tokens: 1 }] });
    });
    expect(request).toContain("spec.md");
    expect(request).toContain("d".repeat(500));
    expect(request).not.toContain("TAIL");
    expect(request).not.toContain("late.md"); // turn 5 is kept verbatim
  });

  test("each search lists its query and its results' titles and URLs, not their snippets", async () => {
    const request = await folded(async (ctx, [u1], _r, s) => {
      await ctx.db.patch("messages", u1._id, { search: true });
      await ctx.db.insert("searches", {
        ownerId: s.ownerId, messageId: u1._id, query: "convex pricing 2026",
        results: [{ title: "Convex Pricing", url: "https://convex.dev/pricing", snippet: "SNIPPET-TEXT" }],
      });
    });
    expect(request).toContain("convex pricing 2026");
    expect(request).toContain("Convex Pricing");
    expect(request).toContain("https://convex.dev/pricing");
    expect(request).not.toContain("SNIPPET-TEXT");
  });

  test("each tool call shows its name, arguments clipped to 300 and its result clipped to 500, errors marked", async () => {
    const request = await folded(async (ctx, _u, [r1]) => {
      await ctx.db.patch("messages", r1._id, {
        parts: [
          { type: "toolCall", step: 1, id: "a", name: "read_file", input: JSON.stringify({ path: "p".repeat(400) }) },
          { type: "toolResult", step: 1, id: "a", text: "r".repeat(600), status: "ok" },
          { type: "toolCall", step: 2, id: "b", name: "run_sql", input: "{}" },
          { type: "toolResult", step: 2, id: "b", text: "syntax boom", status: "error" },
          { type: "text", step: 3, text: "done" },
        ],
      });
    });
    expect(request).toContain("read_file");
    expect(request).toContain("p".repeat(280)); // the argument text, cut at 300 including its JSON wrapper
    expect(request).not.toContain("p".repeat(301));
    expect(request).toContain("r".repeat(500));
    expect(request).not.toContain("r".repeat(501));
    expect(request).toMatch(/run_sql[\s\S]*error[\s\S]*syntax boom/i);
    expect(request).not.toMatch(/read_file[^\n]*error/i);
  });

  test("pinned messages stay out, digests included", async () => {
    const request = await folded(async (ctx, [u1], _r, s) => {
      const id = await ctx.db.insert("documents", { ownerId: s.ownerId, name: "pinned.md", text: "pinned body", tokens: 1 });
      await ctx.db.patch("messages", u1._id, { pinned: true, documents: [{ id, name: "pinned.md", tokens: 1 }] });
    });
    expect(request).not.toContain("pinned.md");
  });
});

describe("condense settings", () => {
  test("the owner turns condensing off and changes the threshold and kept turns, within limits", async () => {
    const s = await setup({ condenseAtTokens: undefined, condenseKeepTurns: undefined, condenseEnabled: undefined });
    expect((await s.owner.query(api.settings.get, {})).condense).toEqual({ enabled: true, atTokens: 80_000, keepTurns: 6 });

    await s.owner.mutation(api.settings.setCondense, { enabled: false });
    expect((await s.inspector())!.condense.state).toBe("off");
    await s.owner.mutation(api.settings.setCondense, { atTokens: 50_000, keepTurns: 4 });
    expect((await s.owner.query(api.settings.get, {})).condense).toEqual({ enabled: false, atTokens: 50_000, keepTurns: 4 });

    await expect(s.owner.mutation(api.settings.setCondense, { atTokens: 100 })).rejects.toThrow("between 5,000 and 500,000");
    await expect(s.owner.mutation(api.settings.setCondense, { keepTurns: 0 })).rejects.toThrow("between 1 and 50");
    await expect(s.owner.mutation(api.settings.setCondense, { keepTurns: 2.5 })).rejects.toThrow("between 1 and 50");
  });

  test("a changed threshold and kept turns apply from the next check", async () => {
    const s = await setup({ condenseAtTokens: 1e9 });
    fake = fakeFetch({ [ANTHROPIC]: provider(() => "Summary one") });
    for (let i = 1; i <= 5; i++) await s.chat(`Turn ${i} ${LONG}`);
    expect(s.summaryCalls()).toHaveLength(0);
    await s.t.run((ctx) => ctx.db.query("settings").first().then((row) => ctx.db.patch("settings", row!._id, { condenseAtTokens: 500 })));
    await s.owner.mutation(api.settings.setCondense, { keepTurns: 3 });
    await s.chat(`Turn 6 ${LONG}`); // 6 turns, keep 3: turns 1 to 3 fold
    const request = text(s.summaryCalls()[0].messages[0].content);
    expect(request).toContain("Turn 3");
    expect(request).not.toContain("Turn 4");
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
