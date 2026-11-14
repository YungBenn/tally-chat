/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeAll(setAuthEnv);
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other" }));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted: "", detected: "",
      keyCheckedAt: 0, models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const lastActiveAt = async () => (await t.run((ctx) => ctx.db.get("threads", threadId)))?.lastActiveAt;
  return { t, owner, other, threadId, lastActiveAt };
}

test("marking activity records when the owner was last active in the thread", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  const s = await setup();
  expect(await s.lastActiveAt()).toBeUndefined();
  await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
  expect(await s.lastActiveAt()).toBeCloseTo(1_000_000, -1); // convex-test nudges the clock by a few ms
  vi.setSystemTime(1_060_000);
  await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
  expect(await s.lastActiveAt()).toBeCloseTo(1_060_000, -1);
});

test("needs a login; a foreign or deleted thread is ignored without an error", async () => {
  const s = await setup();
  await expect(s.t.mutation(api.chat.markActive, { threadId: s.threadId })).rejects.toThrow("Not logged in");
  await s.other.mutation(api.chat.markActive, { threadId: s.threadId });
  expect(await s.lastActiveAt()).toBeUndefined();
  await s.t.run((ctx) => ctx.db.delete("threads", s.threadId));
  await expect(s.owner.mutation(api.chat.markActive, { threadId: s.threadId })).resolves.toBeNull();
});
