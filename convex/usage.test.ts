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
  sse,
  textDelta,
} from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "160.79.104.10", family: 4 }],
}));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

// Sonnet 5.5 per MTok: input $2, output $10, read $0.10, 5m write $2.50.
const REPLY = {
  input_tokens: 100,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  output_tokens: 5,
};
const REPLY_COST = Math.round(100 * 2 + 1000 * 0.1 + 200 * 2.5 + 5 * 10);
const TITLE_COST = Math.round(20 * 2 + 3 * 10);
const KEEPALIVE = {
  inputTokens: 3,
  cacheReadTokens: 2000,
  cacheWriteTokens5m: 0,
  cacheWriteTokens1h: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};
const KEEPALIVE_COST = Math.round(3 * 2 + 2000 * 0.1);

async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 20:00 UTC on Nov 14 is 03:00 on Nov 15 in Jakarta (UTC+7).
  vi.setSystemTime(Date.parse("2026-11-14T20:00:00Z"));
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId,
      name: "A",
      apiStyle: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted,
      detected: "",
      keyCheckedAt: 0,
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
        { id: "local-mystery", displayName: "Mystery", hidden: false },
      ],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  await owner.mutation(api.settings.setTimeZone, { timeZone: "Asia/Jakarta" });
  await owner.mutation(api.settings.setSideJobModel, {
    sideJobModel: { providerId, modelId: "claude-sonnet-5-5" },
  });
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const title =
          (JSON.parse(String(init?.body)) as { max_tokens: number })
            .max_tokens === 30;
        const usage = title
          ? { input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 3 }
          : REPLY;
        return new Response(
          sse(
            messageStart(usage),
            textDelta("ok"),
            messageDelta({}),
            messageStop,
          ),
        );
      },
    },
  });
  const chat = async (modelId = "claude-sonnet-5-5") => {
    const threadId = await owner.mutation(api.chat.createThread, {
      providerId,
      modelId,
    });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    return threadId;
  };
  const keepalive = (threadId: Id<"threads">) =>
    t.mutation(internal.keepalive.record, {
      threadId,
      providerId,
      model: "claude-sonnet-5-5",
      startedAt: Date.now(),
      ttl: "5m",
      sent: true,
      usage: KEEPALIVE,
    });
  const summary = (today: string) => owner.query(api.usage.summary, { today });
  return { t, owner, providerId, chat, keepalive, summary };
}

describe("the usage page", () => {
  test("30 days in the owner's time zone: spend, hit rate without keepalive reads, upkeep and net savings", async () => {
    const s = await setup();
    const thread = await s.chat();
    await s.keepalive(thread);
    const { days, models, savedMicroUsd7, savedMicroUsd30, hitRate30 } =
      await s.summary("2026-11-15");

    expect(days).toHaveLength(30);
    expect(days[0].day).toBe("2026-10-17");
    expect(
      days
        .slice(0, 29)
        .every(
          (d) => d.costMicroUsd === 0 && d.calls === 0 && d.hitRate === null,
        ),
    ).toBe(true);
    const saved = 1000 * 1.9 - 200 * 0.5 - KEEPALIVE_COST; // the reply's caching, net of upkeep
    expect(days[29]).toEqual({
      day: "2026-11-15", // Jakarta's day, not UTC's Nov 14
      costMicroUsd: REPLY_COST + TITLE_COST + KEEPALIVE_COST,
      calls: 3,
      unpricedCalls: 0,
      hitRate: 1000 / (1300 + 20), // reply and title input; the keepalive's 2,000 reads are left out
      upkeepMicroUsd: KEEPALIVE_COST,
      savedMicroUsd: saved,
    });
    expect(models).toEqual([
      {
        model: "claude-sonnet-5-5",
        costMicroUsd: REPLY_COST + TITLE_COST + KEEPALIVE_COST,
        calls: 3,
        unpricedCalls: 0,
      },
    ]);
    expect([savedMicroUsd7, savedMicroUsd30, hitRate30]).toEqual([
      saved,
      saved,
      1000 / 1320,
    ]);
  });

  test("spend from deleted threads still counts; days outside the window drop off", async () => {
    const s = await setup();
    const thread = await s.chat();
    await s.owner.mutation(api.chat.deleteThread, { threadId: thread });
    await s.t.finishAllScheduledFunctions(() => {});
    expect((await s.summary("2026-11-15")).days[29].costMicroUsd).toBe(
      REPLY_COST + TITLE_COST,
    );

    const later = await s.summary("2026-11-21"); // six days later: still in the 7-day window
    expect(later.days[23]).toMatchObject({
      day: "2026-11-15",
      costMicroUsd: REPLY_COST + TITLE_COST,
    });
    expect(later.savedMicroUsd7).toBe(1000 * 1.9 - 200 * 0.5);
    expect((await s.summary("2026-11-22")).savedMicroUsd7).toBe(0); // out of the last 7 days
    expect(
      (await s.summary("2026-12-20")).days.every((d) => d.calls === 0),
    ).toBe(true);
  });

  test("unpriced calls are counted so the totals can say they are a lower bound", async () => {
    const s = await setup();
    await s.chat("local-mystery");
    const day = (await s.summary("2026-11-15")).days[29];
    expect(day).toMatchObject({
      calls: 2,
      unpricedCalls: 1,
      costMicroUsd: TITLE_COST,
    }); // the title ran on priced Sonnet
  });

  test("owner only; rejects a malformed day", async () => {
    const s = await setup();
    await expect(
      s.t.query(api.usage.summary, { today: "2026-11-15" }),
    ).rejects.toThrow("Not logged in");
    await expect(s.summary("yesterday")).rejects.toThrow("Invalid day");
  });
});
