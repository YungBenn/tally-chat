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
