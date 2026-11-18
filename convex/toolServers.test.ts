/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { fakeMcp } from "../test/fakeMcp";
import { api } from "./_generated/api";
import { decryptSecret } from "./lib/vault";
import schema from "./schema";

vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const modules = import.meta.glob("./**/*.ts");
const URL_ = "https://mcp.example.com/mcp";
const TOKEN = "Bearer sk-secret-token";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  return { t, owner: t.withIdentity({ subject: `${ownerId}|session` }) };
}
const search = { name: "search", description: "Search the web", inputSchema: { type: "object", $schema: "http://json-schema.org/draft-07/schema#" } };
const input = { name: "Docs Server", url: URL_, headers: [{ name: "Authorization", value: TOKEN }] };

describe("tool servers", () => {
  test("add tests the connection, lists tools, and encrypts header values", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch(fakeMcp(URL_, { tools: [search, { name: "read" }] }));
    const id = await owner.action(api.toolServerActions.add, input);

    expect(fake.requests.some((r) => r.headers.authorization === TOKEN)).toBe(true);
    const row = await t.run((ctx) => ctx.db.get("toolServers", id));
    expect(row!.slug).toBe("docs_server");
    expect(row!.headersEncrypted).not.toContain("sk-secret");
    expect(JSON.parse(await t.run(() => decryptSecret(row!.headersEncrypted!)))).toEqual({ Authorization: TOKEN });
    expect(JSON.parse(row!.tools[0].inputSchema).$schema).toContain("json-schema");

    const [view] = await owner.query(api.toolServers.list, {});
    expect(view.tools.map((x) => x.name)).toEqual(["search", "read"]);
    expect(view.headerNames).toEqual(["Authorization"]);
    expect(JSON.stringify(view)).not.toContain("sk-secret");
    expect(view).toMatchObject({ onForNewThreads: false, alwaysAllowed: [], lastTest: { ok: true } });
  });

  test("a server that rejects the headers is reported and not saved", async () => {
    const { owner } = await setup();
    fake = fakeFetch(fakeMcp(URL_, { tools: [], status: 401 }));
    await expect(owner.action(api.toolServerActions.add, input)).rejects.toThrow("rejected these headers");
    expect(await owner.query(api.toolServers.list, {})).toEqual([]);
  });

  test("private and non-http URLs are refused unless allowlisted", async () => {
    const { owner } = await setup();
    fake = fakeFetch({});
    await expect(owner.action(api.toolServerActions.add, { name: "x", url: "https://10.0.0.5/mcp" })).rejects.toThrow("private address");
    await expect(owner.action(api.toolServerActions.add, { name: "x", url: "http://mcp.example.com/mcp" })).rejects.toThrow("https");
    await expect(owner.action(api.toolServerActions.add, { name: "x", url: "ftp://x" })).rejects.toThrow("valid http");
    expect(fake.requests).toEqual([]);

    await owner.mutation(api.settings.addAllowedHost, { host: "10.0.0.5" });
    fake.restore();
    fake = fakeFetch(fakeMcp("http://10.0.0.5/mcp", { tools: [search] }));
    await owner.action(api.toolServerActions.add, { name: "lan", url: "http://10.0.0.5/mcp" });
  });

  test("refresh stores the new tool list and drops always-allow for a removed tool; a failure keeps the old list", async () => {
    const { owner } = await setup();
    let tools = [search, { name: "read" }];
    fake = fakeFetch(fakeMcp(URL_, { tools: () => tools }));
    const id = await owner.action(api.toolServerActions.add, input);
    await owner.mutation(api.toolServers.setAlwaysAllowed, { serverId: id, tool: "read", allowed: true });
    await owner.mutation(api.toolServers.setAlwaysAllowed, { serverId: id, tool: "search", allowed: true });
    await owner.mutation(api.toolServers.setOnForNewThreads, { serverId: id, on: true });

    tools = [search];
    await owner.action(api.toolServerActions.refresh, { serverId: id });
    let [view] = await owner.query(api.toolServers.list, {});
    expect(view.tools.map((x) => x.name)).toEqual(["search"]);
    expect(view.alwaysAllowed).toEqual(["search"]);
    expect(view.onForNewThreads).toBe(true);

    fake.restore();
    fake = fakeFetch(fakeMcp(URL_, { tools: [], status: 500 }));
    await owner.action(api.toolServerActions.refresh, { serverId: id });
    [view] = await owner.query(api.toolServers.list, {});
    expect(view.tools.map((x) => x.name)).toEqual(["search"]);
    expect(view.lastTest).toMatchObject({ ok: false });
    expect(view.lastTest!.error).toBeTruthy();
    await expect(owner.mutation(api.toolServers.setAlwaysAllowed, { serverId: id, tool: "nope", allowed: true })).rejects.toThrow("no such tool");
  });

  test("edit keeps headers unless replaced; remove deletes; another owner can't touch it", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch(fakeMcp(URL_, { tools: [search] }));
    const id = await owner.action(api.toolServerActions.add, input);
    await owner.action(api.toolServerActions.edit, { serverId: id, name: "Renamed", url: URL_ });
    let row = await t.run((ctx) => ctx.db.get("toolServers", id));
    expect(row).toMatchObject({ name: "Renamed", slug: "docs_server", headerNames: ["Authorization"] });
    expect(fake.requests.at(-1)!.headers.authorization).toBe(TOKEN);

    await owner.action(api.toolServerActions.edit, { serverId: id, name: "Renamed", url: URL_, headers: [{ name: "X-Key", value: "k" }] });
    row = await t.run((ctx) => ctx.db.get("toolServers", id));
    expect(row!.headerNames).toEqual(["X-Key"]);

    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "other" }));
    const other = t.withIdentity({ subject: `${otherId}|session` });
    await expect(other.mutation(api.toolServers.remove, { serverId: id })).rejects.toThrow("not found");
    expect(await other.query(api.toolServers.list, {})).toEqual([]);
    await owner.mutation(api.toolServers.remove, { serverId: id });
    expect(await owner.query(api.toolServers.list, {})).toEqual([]);
  });

  test("two servers with the same name get distinct slugs", async () => {
    const { t, owner } = await setup();
    fake = fakeFetch(fakeMcp(URL_, { tools: [search] }));
    const a = await owner.action(api.toolServerActions.add, { name: "Docs", url: URL_ });
    const b = await owner.action(api.toolServerActions.add, { name: "Docs", url: URL_ });
    const slugs = await t.run(async (ctx) => [(await ctx.db.get("toolServers", a))!.slug, (await ctx.db.get("toolServers", b))!.slug]);
    expect(slugs).toEqual(["docs", "docs_2"]);
  });
});
