/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeAll(setAuthEnv);

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other" }));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted: "", detected: "", keyCheckedAt: 0, models: [],
    }),
  );
  const thread = (owner: Id<"users">, title: string) =>
    t.run((ctx) => ctx.db.insert("threads", { ownerId: owner, title, providerId, modelId: "m", systemPromptVersion: 2 }));
  const message = (owner: Id<"users">, threadId: Id<"threads">, content: string, extra: { status?: "streaming"; role?: "assistant" } = {}) =>
    t.run((ctx) =>
      ctx.db.insert("messages", {
        ownerId: owner, threadId, ancestorIds: [], role: extra.role ?? "user", pinned: false, content, status: extra.status ?? "done",
      }),
    );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const search = (query: string) => owner.query(api.search.search, { query });
  return { t, ownerId, otherId, thread, message, owner, search };
}

test("title search returns only the owner's matching threads, at most 20", async () => {
  const s = await setup();
  await s.thread(s.ownerId, "Plan a day in Kyoto");
  await s.thread(s.ownerId, "Packing for rain");
  await s.thread(s.otherId, "Kyoto ramen guide");
  for (let i = 0; i < 25; i++) await s.thread(s.ownerId, `Budget notes ${i}`);

  expect((await s.search("kyoto")).titles.map((r) => r.title)).toEqual(["Plan a day in Kyoto"]);
  expect(await s.search("   ")).toEqual({ titles: [], messages: [] });
  expect((await s.search("budget")).titles).toHaveLength(20);
  await expect(s.t.query(api.search.search, { query: "kyoto" })).rejects.toThrow("Not logged in");
});

test("message search finds the owner's finished messages, with their thread and a snippet", async () => {
  const s = await setup();
  const dates = await s.thread(s.ownerId, "Log tooling");
  const hit = await s.message(s.ownerId, dates, `${"Some context first. ".repeat(10)}Here is that regex for parsing dates in logs.`, { role: "assistant" });
  await s.message(s.ownerId, dates, "a regex still streaming", { status: "streaming" });
  await s.message(s.otherId, await s.thread(s.otherId, "Theirs"), "their regex");
  const gone = await s.thread(s.ownerId, "Deleted");
  await s.message(s.ownerId, gone, "a regex in a deleted thread");
  await s.t.run((ctx) => ctx.db.delete("threads", gone));

  const { titles, messages } = await s.search("regex");
  expect(titles).toEqual([]);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ messageId: hit, threadId: dates, threadTitle: "Log tooling", role: "assistant" });
  expect(messages[0].snippet).toMatch(/^….*that regex for parsing dates in logs\.$/);

  const many = await s.thread(s.ownerId, "Many");
  for (let i = 0; i < 35; i++) await s.message(s.ownerId, many, `widget number ${i}`);
  expect((await s.search("widget")).messages).toHaveLength(30);
});
