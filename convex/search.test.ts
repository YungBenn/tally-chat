/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeAll(setAuthEnv);

test("title search returns only the owner's matching threads, at most 20", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  const otherId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "other" }),
  );
  await t.run(async (ctx) => {
    const providerId = await ctx.db.insert("providers", {
      ownerId,
      name: "A",
      apiStyle: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted: "",
      detected: "",
      keyCheckedAt: 0,
      models: [],
    });
    const thread = (owner: typeof ownerId, title: string) =>
      ctx.db.insert("threads", {
        ownerId: owner,
        title,
        providerId,
        modelId: "m",
        systemPromptVersion: 2,
      });
    await thread(ownerId, "Plan a day in Kyoto");
    await thread(ownerId, "Packing for rain");
    await thread(otherId, "Kyoto ramen guide");
    for (let i = 0; i < 25; i++) await thread(ownerId, `Budget notes ${i}`);
  });
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const search = (query: string) =>
    owner.query(api.chat.searchThreads, { query });

  expect((await search("kyoto")).map((r) => r.title)).toEqual([
    "Plan a day in Kyoto",
  ]);
  expect(await search("   ")).toEqual([]);
  expect(await search("budget")).toHaveLength(20);
  await expect(
    t.query(api.chat.searchThreads, { query: "kyoto" }),
  ).rejects.toThrow("Not logged in");
});
