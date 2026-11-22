/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeAll(setAuthEnv);

test("the migration moves presence and cache bookkeeping off threads, and running it again changes nothing", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted: "", detected: "",
      keyCheckedAt: 0, models: [{ id: "m", displayName: "M", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const base = { ownerId, providerId, modelId: "m", systemPromptVersion: 2 };
  // From before phase 12: the bookkeeping on the thread row. One also got presence after the
  // deploy, before the migration ran: that newer value stays.
  const [old, active, plain] = await t.run(async (ctx) => [
    await ctx.db.insert("threads", { ...base, title: "old", lastActiveAt: 1000, cacheTouchedAt: 2000, cacheTtl: "1h" }),
    await ctx.db.insert("threads", { ...base, title: "active", lastActiveAt: 1000, cacheTouchedAt: 3000 }),
    await ctx.db.insert("threads", { ...base, title: "plain" }),
  ]);
  await owner.mutation(api.chat.markActive, { threadId: active });
  const presence = (await owner.query(api.threadState.cache, { threadId: active }))!.lastActiveAt!;
  expect(presence).toBeGreaterThan(1000);

  await t.mutation(internal.migrations.moveThreadState, {});
  await t.finishAllScheduledFunctions(() => {});
  const cache = (threadId: typeof old) => owner.query(api.threadState.cache, { threadId });
  expect(await cache(old)).toEqual({ expiresAt: 2000 + 60 * 60_000, keepaliveScheduled: false, lastActiveAt: 1000 });
  expect(await cache(active)).toEqual({ expiresAt: 3000 + 5 * 60_000, keepaliveScheduled: false, lastActiveAt: presence });
  expect(await cache(plain)).toEqual({ expiresAt: null, keepaliveScheduled: false, lastActiveAt: null });
  const threads = await t.run((ctx) => ctx.db.query("threads").collect());
  for (const th of threads)
    expect([th.lastActiveAt, th.cacheTouchedAt, th.cacheTtl, th.keepaliveJobId]).toEqual([undefined, undefined, undefined, undefined]);

  const rows = await t.run((ctx) => ctx.db.query("threadStates").collect());
  expect(rows).toHaveLength(2); // a thread with nothing to move gets no row
  await t.mutation(internal.migrations.moveThreadState, {});
  await t.finishAllScheduledFunctions(() => {});
  expect(await t.run((ctx) => ctx.db.query("threadStates").collect())).toEqual(rows);
});
