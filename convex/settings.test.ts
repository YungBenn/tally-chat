/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  return { t, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
}

describe("private host allowlist", () => {
  test("owner can add and remove hosts; entries are normalized and deduplicated", async () => {
    const { owner } = await setup();
    await owner.mutation(api.settings.addAllowedHost, {
      host: " 192.168.1.20:11434 ",
    });
    await owner.mutation(api.settings.addAllowedHost, { host: "Ollama.LAN" });
    await owner.mutation(api.settings.addAllowedHost, { host: "ollama.lan" });
    expect((await owner.query(api.settings.get, {})).allowlistedHosts).toEqual([
      "192.168.1.20:11434",
      "ollama.lan",
    ]);
    await owner.mutation(api.settings.removeAllowedHost, {
      host: "ollama.lan",
    });
    expect((await owner.query(api.settings.get, {})).allowlistedHosts).toEqual([
      "192.168.1.20:11434",
    ]);
  });

  test("rejects entries with a scheme, path or credentials", async () => {
    const { owner } = await setup();
    for (const host of [
      "http://192.168.1.20",
      "192.168.1.20/v1",
      "user:pass@host",
      "",
    ]) {
      await expect(
        owner.mutation(api.settings.addAllowedHost, { host }),
      ).rejects.toThrow("Enter a host");
    }
  });

  test("requires the owner", async () => {
    const { t } = await setup();
    await expect(t.query(api.settings.get, {})).rejects.toThrow(
      "Not logged in",
    );
    await expect(
      t.mutation(api.settings.addAllowedHost, { host: "x.lan" }),
    ).rejects.toThrow("Not logged in");
  });
});

test("the cache-break confirmation threshold defaults to $0.10 and refuses negative amounts", async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  expect(
    (await owner.query(api.settings.get, {})).cacheBreakConfirmMicroUsd,
  ).toBe(100_000);
  await owner.mutation(api.settings.setCacheBreakConfirm, {
    microUsd: 250_000,
  });
  expect(
    (await owner.query(api.settings.get, {})).cacheBreakConfirmMicroUsd,
  ).toBe(250_000);
  await expect(
    owner.mutation(api.settings.setCacheBreakConfirm, { microUsd: -1 }),
  ).rejects.toThrow("$0 or more");
});

describe("new-thread defaults", () => {
  async function withProvider() {
    const { t, owner } = await setup();
    const providerId = await t.run(async (ctx) => {
      const ownerId = (await ctx.db.query("users").first())!._id;
      return ctx.db.insert("providers", {
        ownerId,
        name: "A",
        apiStyle: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKeyEncrypted: "x",
        detected: "",
        keyCheckedAt: 0,
        models: [
          { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
          { id: "claude-old", displayName: "Old", hidden: true },
        ],
      });
    });
    return { owner, providerId };
  }

  test("default model and effort are unset until chosen, then saved and cleared", async () => {
    const { owner, providerId } = await withProvider();
    const before = await owner.query(api.settings.get, {});
    expect(before.defaultModel).toBeNull();
    expect(before.defaultEffort).toBeNull();

    await owner.mutation(api.settings.setDefaultModel, {
      defaultModel: { providerId, modelId: "claude-sonnet-5-5" },
    });
    await owner.mutation(api.settings.setDefaultEffort, { effort: "high" });
    const after = await owner.query(api.settings.get, {});
    expect(after.defaultModel).toEqual({
      providerId,
      modelId: "claude-sonnet-5-5",
    });
    expect(after.defaultEffort).toBe("high");

    await owner.mutation(api.settings.setDefaultModel, { defaultModel: null });
    await owner.mutation(api.settings.setDefaultEffort, { effort: null });
    const cleared = await owner.query(api.settings.get, {});
    expect(cleared.defaultModel).toBeNull();
    expect(cleared.defaultEffort).toBeNull();
  });

  test("the default model must be a visible model of the owner's provider", async () => {
    const { owner, providerId } = await withProvider();
    await expect(
      owner.mutation(api.settings.setDefaultModel, {
        defaultModel: { providerId, modelId: "claude-old" },
      }),
    ).rejects.toThrow("Model not available");
    await expect(
      owner.mutation(api.settings.setDefaultModel, {
        defaultModel: { providerId, modelId: "missing" },
      }),
    ).rejects.toThrow("Model not available");
  });
});
