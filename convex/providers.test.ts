/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { api } from "./_generated/api";
import { decryptSecret } from "./lib/vault";
import schema from "./schema";

// Public DNS answer for every hostname; the guard itself is tested in lib/urlGuard.test.ts.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

const modules = import.meta.glob("./**/*.ts");
const MODELS_URL = "GET https://api.anthropic.com/v1/models?limit=1000";
const KEY = "sk-ant-test-0123456789abcdef";
const modelsOk = {
  body: { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }, { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }] },
  headers: { "anthropic-organization-id": "1a2b3c4d-aaaa-bbbb" },
};
const input = { name: "My Anthropic", apiStyle: "anthropic" as const, baseUrl: "https://api.anthropic.com/", apiKey: KEY };

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  return { t, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
}

describe("adding an Anthropic provider", () => {
  test("tests the key, stores it encrypted, and pulls the model list", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const id = await owner.action(api.providerActions.add, input);

    expect(fake.requests[0].headers["x-api-key"]).toBe(KEY);
    const row = await t.run((ctx) => ctx.db.get("providers", id));
    expect(row!.apiKeyEncrypted).not.toContain(KEY);
    expect(await t.run(() => decryptSecret(row!.apiKeyEncrypted))).toBe(KEY);
    expect(row!.baseUrl).toBe("https://api.anthropic.com");

    const [view] = await owner.query(api.providers.list, {});
    expect(view.detected).toBe("Anthropic · org 1a2b3c4d");
    expect(view.models.map((m) => m.displayName)).toEqual(["Claude Sonnet 5.5", "Claude Haiku 5.5"]);
  });

  test("a rejected key is reported and nothing is saved", async () => {
    const { owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: { status: 401, body: { error: { type: "authentication_error" } } } });
    await expect(owner.action(api.providerActions.add, input)).rejects.toThrow("rejected this key");
    expect(await owner.query(api.providers.list, {})).toEqual([]);
  });

  test("non-https and private base URLs are refused before any request", async () => {
    const { owner } = await setup();
    fake = fakeFetch({});
    await expect(owner.action(api.providerActions.add, { ...input, baseUrl: "http://api.anthropic.com" })).rejects.toThrow("https");
    await expect(owner.action(api.providerActions.add, { ...input, baseUrl: "https://10.0.0.5" })).rejects.toThrow("private address");
    expect(fake.requests).toEqual([]);
  });

  test("an allowlisted private host is reachable, over http too", async () => {
    const { owner } = await setup();
    await owner.mutation(api.settings.addAllowedHost, { host: "192.168.1.20:8080" });
    fake = fakeFetch({ "GET http://192.168.1.20:8080/v1/models?limit=1000": modelsOk });
    await owner.action(api.providerActions.add, { ...input, baseUrl: "http://192.168.1.20:8080" });
    expect(fake.requests).toHaveLength(1);
  });

  test("requires the owner to be logged in", async () => {
    const { t } = await setup();
    await expect(t.action(api.providerActions.add, input)).rejects.toThrow("Not logged in");
    await expect(t.query(api.providers.list, {})).rejects.toThrow("Not logged in");
  });
});

describe("key material never leaves the server", () => {
  test("list returns no key, plaintext or encrypted, and nothing is logged with the key", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...a) => void logs.push(JSON.stringify(a)));
    }
    const id = await owner.action(api.providerActions.add, input);
    vi.restoreAllMocks();

    const stored = (await t.run((ctx) => ctx.db.get("providers", id)))!.apiKeyEncrypted;
    const listed = JSON.stringify(await owner.query(api.providers.list, {}));
    expect(listed).not.toContain(KEY);
    expect(listed).not.toContain(stored);
    expect(listed).not.toContain("apiKeyEncrypted");
    expect(logs.join("\n")).not.toContain(KEY);
  });
});

describe("managing a provider", () => {
  test("owner can hide and rename models", async () => {
    const { owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const providerId = await owner.action(api.providerActions.add, input);
    await owner.mutation(api.providers.updateModel, { providerId, modelId: "claude-haiku-5-5", hidden: true });
    await owner.mutation(api.providers.updateModel, { providerId, modelId: "claude-sonnet-5-5", displayName: "Sonnet" });
    const [view] = await owner.query(api.providers.list, {});
    expect(view.models).toEqual([
      { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false, vision: false },
      { id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5", hidden: true, vision: false },
    ]);
  });

  test("replacing a key tests and stores the new one; a bad replacement keeps the old", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const providerId = await owner.action(api.providerActions.add, input);
    await owner.action(api.providerActions.replaceKey, { providerId, apiKey: "sk-ant-new-key" });
    const keyOf = async () => t.run(async (ctx) => decryptSecret((await ctx.db.get("providers", providerId))!.apiKeyEncrypted));
    expect(await keyOf()).toBe("sk-ant-new-key");

    fake.restore();
    fake = fakeFetch({ [MODELS_URL]: { status: 401, body: {} } });
    await expect(owner.action(api.providerActions.replaceKey, { providerId, apiKey: "sk-ant-bad" })).rejects.toThrow("rejected");
    expect(await keyOf()).toBe("sk-ant-new-key");
  });

  test("a key saved under another master key is reported as such, and replacing it recovers", async () => {
    const { owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const providerId = await owner.action(api.providerActions.add, input);
    const original = process.env.TALLY_MASTER_KEY;
    process.env.TALLY_MASTER_KEY = btoa(String.fromCharCode(...new Uint8Array(32))); // e.g. restored without its secrets file
    try {
      await expect(owner.action(api.providerActions.refreshModels, { providerId })).rejects.toThrow("can't be decrypted");
      await owner.action(api.providerActions.replaceKey, { providerId, apiKey: KEY });
      await owner.action(api.providerActions.refreshModels, { providerId });
    } finally {
      process.env.TALLY_MASTER_KEY = original;
    }
  });

  test("owner can delete a provider", async () => {
    const { owner } = await setup();
    fake = fakeFetch({ [MODELS_URL]: modelsOk });
    const providerId = await owner.action(api.providerActions.add, input);
    await owner.mutation(api.providers.remove, { providerId });
    expect(await owner.query(api.providers.list, {})).toEqual([]);
  });
});
