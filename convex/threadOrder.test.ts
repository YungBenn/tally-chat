/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeAll(setAuthEnv);

test("threads list by start time, and the backfill gives old threads their creation time", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted: "", detected: "",
      keyCheckedAt: 0, models: [{ id: "m", displayName: "M", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  // One from before phase 7 (no start time) and one imported with an old original date.
  const [legacy, imported] = await t.run(async (ctx) => [
    await ctx.db.insert("threads", { ownerId, title: "legacy", providerId, modelId: "m", systemPromptVersion: 2 }),
    await ctx.db.insert("threads", { ownerId, title: "imported", providerId, modelId: "m", systemPromptVersion: 2, startedAt: 1000 }),
  ]);
  const fresh = await owner.mutation(api.chat.createThread, { providerId, modelId: "m" });
  const freshDoc = await t.run((ctx) => ctx.db.get("threads", fresh));
  expect(freshDoc!.startedAt).toBeGreaterThan(1000);

  await t.mutation(internal.migrations.backfillThreadStartedAt, {});
  await t.finishAllScheduledFunctions(() => {});
  const legacyDoc = await t.run((ctx) => ctx.db.get("threads", legacy));
  expect(legacyDoc!.startedAt).toBe(legacyDoc!._creationTime);
  // Running it again changes nothing; the imported thread keeps its original date.
  await t.mutation(internal.migrations.backfillThreadStartedAt, {});
  expect((await t.run((ctx) => ctx.db.get("threads", imported)))!.startedAt).toBe(1000);

  const list = await owner.query(api.chat.listThreads, {});
  expect(list.map((r) => r.title)).toEqual(["New thread", "legacy", "imported"]);
  expect(list[2].startedAt).toBe(1000);
});

test("pinned threads list first, most recently pinned on top, until unpinned", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted: "", detected: "",
      keyCheckedAt: 0, models: [{ id: "m", displayName: "M", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const [a, b, c] = await t.run(async (ctx) =>
    Promise.all(["a", "b", "c"].map((title, i) =>
      ctx.db.insert("threads", { ownerId, title, providerId, modelId: "m", systemPromptVersion: 2, startedAt: 1000 + i }),
    )),
  );
  const titles = async () => (await owner.query(api.chat.listThreads, {})).map((r) => `${r.title}${r.pinned ? "*" : ""}`);
  expect(await titles()).toEqual(["c", "b", "a"]);

  await owner.mutation(api.chat.setThreadPinned, { threadId: a, pinned: true });
  await new Promise((r) => setTimeout(r, 2));
  await owner.mutation(api.chat.setThreadPinned, { threadId: b, pinned: true });
  expect(await titles()).toEqual(["b*", "a*", "c"]);

  await owner.mutation(api.chat.setThreadPinned, { threadId: b, pinned: false });
  expect(await titles()).toEqual(["a*", "c", "b"]);

  const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "other" }));
  const stranger = t.withIdentity({ subject: `${strangerId}|session` });
  await expect(stranger.mutation(api.chat.setThreadPinned, { threadId: c, pinned: true })).rejects.toThrow("Thread not found");
});
