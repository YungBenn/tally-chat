/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

// Sonnet 5.5 per MTok: input $2, cache read $0.10, 5m write $2.50, 1h write $4.
// So a read saves 1.9 µ$ per token, a 5m write costs 0.5 more, a 1h write 2 more.
const KEEPALIVE_USAGE = { inputTokens: 3, cacheReadTokens: 2000, cacheWriteTokens5m: 0, cacheWriteTokens1h: 0, outputTokens: 0, reasoningTokens: 0 };

async function setup(replyUsages: object[]) {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted, detected: "", keyCheckedAt: 0,
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  // Title side jobs go to the same model; keep them cache-free so they save nothing.
  await owner.mutation(api.settings.setSideJobModel, { sideJobModel: { providerId, modelId: "claude-sonnet-5-5" } });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  let reply = 0;
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const title = (JSON.parse(String(init?.body)) as { max_tokens: number }).max_tokens === 512;
        const usage = title ? { input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 3 } : replyUsages[reply++];
        return new Response(sse(messageStart(usage), textDelta("ok"), messageDelta({ output_tokens: 5 }), messageStop));
      },
    },
  });
  const send = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const keepalive = () =>
    t.mutation(internal.keepalive.record, {
      threadId, providerId, model: "claude-sonnet-5-5", startedAt: Date.now(), ttl: "5m", sent: true, usage: KEEPALIVE_USAGE,
      reports: { caching: true, reasoning: false },
    });
  // This thread's rows across all its days, through the per-thread index.
  const rows = (dimension: "thread" | "upkeep" | "model") =>
    t.run((ctx) =>
      ctx.db
        .query("dailyUsage")
        .withIndex("by_owner_dimension_key_day", (q) =>
          q.eq("ownerId", ownerId).eq("dimension", dimension).eq("key", dimension === "model" ? "claude-sonnet-5-5" : threadId),
        )
        .take(400),
    );
  return { t, owner, ownerId, threadId, send, keepalive, rows };
}

describe("rollups for upkeep and savings", () => {
  test("a reply's savings are its read discount minus its write premium; a keepalive also lands under upkeep", async () => {
    const s = await setup([{ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 1 }]);
    await s.send("Hi");
    await s.keepalive();

    const [thread] = await s.rows("thread");
    expect(thread.savedMicroUsd).toBe(1000 * 1.9 - 200 * 0.5 + 2000 * 1.9); // reply 1,800 + keepalive 3,800
    expect(thread.calls).toBe(3); // reply, title, keepalive

    const [upkeep] = await s.rows("upkeep");
    expect(upkeep).toMatchObject({ calls: 1, cacheReadTokens: 2000, savedMicroUsd: 3800, costMicroUsd: Math.round(3 * 2 + 2000 * 0.1) });
    expect((await s.rows("model"))[0].savedMicroUsd).toBe(thread.savedMicroUsd);
  });

  test("savings go negative when writes outweigh reads", async () => {
    const s = await setup([{ input_tokens: 10, cache_read_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 1000 }, cache_creation_input_tokens: 1000, output_tokens: 1 }]);
    await s.send("Hi");
    expect((await s.rows("thread"))[0].savedMicroUsd).toBe(-2000);
  });

  test("a free provider saves nothing", async () => {
    const s = await setup([{ input_tokens: 10, cache_read_input_tokens: 5000, output_tokens: 1 }]);
    await s.t.run(async (ctx) => {
      for (const p of await ctx.db.query("providers").collect()) await ctx.db.patch("providers", p._id, { free: true });
    });
    await s.send("Hi");
    expect((await s.rows("thread"))[0].savedMicroUsd).toBe(0);
  });

  test("thread delete keeps every rollup row, upkeep included", async () => {
    const s = await setup([{ input_tokens: 10, cache_read_input_tokens: 500, output_tokens: 1 }]);
    await s.send("Hi");
    await s.keepalive();
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(await s.rows("thread")).toHaveLength(1);
    expect(await s.rows("upkeep")).toHaveLength(1);
  });

  test("the backfill rebuilds what metering wrote, and running it twice changes nothing", async () => {
    const s = await setup([
      { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 3000, output_tokens: 1 },
      { input_tokens: 5, cache_read_input_tokens: 3000, cache_creation_input_tokens: 40, output_tokens: 1 },
    ]);
    await s.send("One");
    await s.send("Two");
    await s.keepalive();
    const metered = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());

    // Pretend these rows predate phase 3: no savings, no upkeep rows.
    await s.t.run(async (ctx) => {
      for (const r of await ctx.db.query("dailyUsage").collect()) {
        if (r.dimension === "upkeep") await ctx.db.delete("dailyUsage", r._id);
        else await ctx.db.patch("dailyUsage", r._id, { savedMicroUsd: undefined });
      }
    });
    const strip = (rows: typeof metered) =>
      rows
        .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_"))))
        .sort((a, b) => `${a.dimension}${a.key}`.localeCompare(`${b.dimension}${b.key}`));

    await s.t.mutation(internal.migrations.backfillRollupsPhase3, {});
    const once = await s.t.run((ctx) => ctx.db.query("dailyUsage").collect());
    expect(strip(once)).toEqual(strip(metered));
    await s.t.mutation(internal.migrations.backfillRollupsPhase3, {});
    expect(strip(await s.t.run((ctx) => ctx.db.query("dailyUsage").collect()))).toEqual(strip(metered));
  });
});
