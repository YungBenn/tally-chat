/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { decryptSecret, encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const EXA_URL = "POST https://api.exa.ai/search";
const EXA_KEY = "exa-test-key-123";
const RESULTS = {
  requestId: "r1",
  results: [
    { id: "1", title: "Convex | All gas", url: "https://www.convex.dev/", highlights: ["Convex is the all-in-one backend."] },
    { id: "2", title: "Convex docs", url: "https://docs.convex.dev/", highlights: ["x".repeat(400)] },
  ],
};
// Exa answers by query, so one fixture serves searches for different texts.
const exa = (byQuery: Record<string, Recorded>): Recorded => ({
  respond: (init) => {
    const { query } = JSON.parse(init!.body as string) as { query: string };
    const r = byQuery[query];
    if (!r) throw new Error(`no Exa fixture for ${query}`);
    if ("respond" in r) return r.respond(init);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  },
});

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "Anthropic", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted, detected: "", keyCheckedAt: 0,
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const settle = () => t.finishAllScheduledFunctions(() => {});
  const saveKey = (apiKey = EXA_KEY) => owner.action(api.settings.setSearchKey, { apiKey });
  const send = async (content: string, search = true) => {
    await owner.mutation(api.chat.send, { threadId, content, search });
    await settle();
  };
  const thread = async () => (await owner.query(api.chat.getThread, { threadId }))!;
  const modelRequests = () =>
    fake!.requests.filter((r) => `${r.method} ${r.url}` === MESSAGES_URL).map((r) => r.body as { messages: { role: string; content: unknown }[] });
  const searchRequests = () => fake!.requests.filter((r) => `${r.method} ${r.url}` === EXA_URL);
  return { t, ownerId, owner, threadId, saveKey, send, settle, thread, modelRequests, searchRequests };
}

const fixtures = (byQuery: Record<string, Recorded> = {}) => ({
  [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) },
  [EXA_URL]: exa(byQuery),
});
const firstUserText = (body: { messages: { role: string; content: unknown }[] }) => {
  const c = body.messages[0].content;
  return typeof c === "string" ? c : (c as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
};
const failedBlock = (query: string, error: string) =>
  `${query}\n\n<web_search query=${JSON.stringify(query)}>\nThe web search failed (${error}), so there are no results.\n</web_search>`;

describe("web search settings", () => {
  test("saves the key trimmed and encrypted, never returns it, and empty text clears it", async () => {
    const { t, owner, saveKey } = await setup();
    expect((await owner.query(api.settings.get, {})).searchKeySet).toBe(false);
    await saveKey(`  ${EXA_KEY}\n`);

    const stored = await t.run(async (ctx) => (await ctx.db.query("settings").unique())!.searchKeyEncrypted!);
    expect(stored).not.toContain(EXA_KEY);
    expect(await t.run(() => decryptSecret(stored))).toBe(EXA_KEY);
    const view = await owner.query(api.settings.get, {});
    expect(view.searchKeySet).toBe(true);
    expect(JSON.stringify(view)).not.toContain(EXA_KEY);
    expect(JSON.stringify(view)).not.toContain(stored);

    await saveKey("  ");
    expect((await owner.query(api.settings.get, {})).searchKeySet).toBe(false);
  });

  test("saving a key runs no search", async () => {
    const { saveKey } = await setup();
    fake = fakeFetch({});
    await saveKey();
    expect(fake.requests).toHaveLength(0);
  });

  test("a legacy SearXNG URL in stored settings still reads fine", async () => {
    const { t, ownerId, owner } = await setup();
    await t.run((ctx) => ctx.db.insert("settings", { ownerId, allowlistedHosts: [], searchUrl: "http://searxng:8080" }));
    expect((await owner.query(api.settings.get, {})).searchKeySet).toBe(false);
  });

  test("searching needs a key first", async () => {
    const { owner, threadId } = await setup();
    await expect(owner.mutation(api.chat.send, { threadId, content: "Hi", search: true })).rejects.toThrow(
      "Add an Exa API key in Settings to search the web",
    );
  });
});

describe("searching before a reply", () => {
  test("asks Exa with the key and the agreed body", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ "What is Convex?": { body: RESULTS } }));
    await s.send("What is Convex?");

    const [request] = s.searchRequests();
    expect(request.headers["x-api-key"]).toBe(EXA_KEY);
    expect(request.body).toEqual({ query: "What is Convex?", type: "auto", numResults: 6, contents: { highlights: true } });
  });

  test("sends the results with the message, and shows them as sources", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ "What is Convex?": { body: RESULTS } }));
    await s.send("What is Convex?");

    expect(s.searchRequests()).toHaveLength(1);
    const text = firstUserText(s.modelRequests()[0]);
    expect(text).toBe(
      [
        "What is Convex?",
        "",
        '<web_search query="What is Convex?">',
        "Results of a web search run for this message. Use them where they help, and cite sources by URL.",
        "",
        "[1] Convex | All gas",
        "https://www.convex.dev/",
        "Convex is the all-in-one backend.",
        "",
        "[2] Convex docs",
        "https://docs.convex.dev/",
        `${"x".repeat(299)}…`,
        "</web_search>",
      ].join("\n"),
    );
    const [user, reply] = (await s.thread()).messages;
    expect(user.text).toBe("What is Convex?");
    expect(user.search).toEqual({
      status: "done",
      results: [
        { title: "Convex | All gas", url: "https://www.convex.dev/" },
        { title: "Convex docs", url: "https://docs.convex.dev/" },
      ],
    });
    expect(reply).toMatchObject({ status: "done", text: "ok" });
  });

  test("a retry and a later turn reuse the stored results, so the bytes never change", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ "What is Convex?": { body: RESULTS } }));
    await s.send("What is Convex?");
    const replyId = (await s.thread()).messages[1]._id;
    await s.owner.mutation(api.chat.retry, { messageId: replyId });
    await s.settle();
    await s.send("Thanks", false);

    expect(s.searchRequests()).toHaveLength(1);
    const [first, retry, later] = s.modelRequests();
    expect(firstUserText(retry)).toBe(firstUserText(first));
    expect(firstUserText(later)).toBe(firstUserText(first));
    expect(later.messages).toHaveLength(3); // the search message, the retried reply, "Thanks"
  });

  test("before its reply is measured, a searched turn is estimated with the results", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { body: RESULTS } }));
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", search: true });
    const view = await s.owner.query(api.inspector.get, { threadId: s.threadId });
    expect(view!.layers.find((l) => l.kind === "turns")).toMatchObject({ tokens: 1 + 900, estimated: true });
    await s.settle();
  });

  test("deleting the thread removes its stored searches", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { body: RESULTS } }));
    await s.send("Hi");
    expect(await s.t.run((ctx) => ctx.db.query("searches").collect())).toHaveLength(1);
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.settle();
    expect(await s.t.run((ctx) => ctx.db.query("searches").collect())).toHaveLength(0);
  });

  test("a rejected key still gets a reply, told why in Exa's words", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { status: 401, body: { requestId: "r2", error: "Invalid API key" } } }));
    await s.send("Hi");

    expect(firstUserText(s.modelRequests()[0])).toBe(failedBlock("Hi", "HTTP 401: Invalid API key"));
    const [user, reply] = (await s.thread()).messages;
    expect(user.search).toEqual({ status: "failed", results: [], error: "HTTP 401: Invalid API key" });
    expect(reply.status).toBe("done");
  });

  test("an error without Exa's message is just its status", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { status: 502, body: "Bad Gateway" } }));
    await s.send("Hi");

    expect(firstUserText(s.modelRequests()[0])).toBe(failedBlock("Hi", "HTTP 502"));
  });

  test("a network failure keeps its message", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { respond: () => { throw new TypeError("fetch failed"); } } }));
    await s.send("Hi");

    const [user, reply] = (await s.thread()).messages;
    expect(user.search).toEqual({ status: "failed", results: [], error: "fetch failed" });
    expect(reply.status).toBe("done");
  });

  test("a key that can't be decrypted fails the search, and the reply still runs", async () => {
    const s = await setup();
    await s.saveKey();
    // Saved under another master key: the stored form is valid, the ciphertext isn't ours.
    await s.t.run(async (ctx) => {
      const settings = (await ctx.db.query("settings").unique())!;
      await ctx.db.patch("settings", settings._id, { searchKeyEncrypted: "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==" });
    });
    fake = fakeFetch(fixtures());
    await s.send("Hi");

    expect(s.searchRequests()).toHaveLength(0);
    const [user, reply] = (await s.thread()).messages;
    expect(user.search).toMatchObject({ status: "failed", error: expect.stringContaining("Exa API key can't be decrypted") });
    expect(reply.status).toBe("done");
  });

  test("removing the key before the search runs fails it as off", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures());
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", search: true });
    await s.saveKey("");
    await s.settle();

    expect(s.searchRequests()).toHaveLength(0);
    expect((await s.thread()).messages[0].search).toEqual({ status: "failed", results: [], error: "web search is off" });
  });

  test("an edit of a searched message searches again for the new text", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ "What is Convex?": { body: RESULTS }, "What is Bun?": { body: { results: [] } } }));
    await s.send("What is Convex?");
    await s.owner.mutation(api.chat.edit, { messageId: (await s.thread()).messages[0]._id, content: "What is Bun?" });
    await s.settle();

    expect(s.searchRequests()).toHaveLength(2);
    expect(firstUserText(s.modelRequests()[1])).toBe('What is Bun?\n\n<web_search query="What is Bun?">\nThe web search returned no results.\n</web_search>');
  });
});

describe("metering searches", () => {
  // Exa reports cost as costDollars.total (its OpenAPI spec's CostDollarsOutput).
  const PRICED = { ...RESULTS, costDollars: { total: 0.007, search: { neural: 0.005 }, contents: { highlights: 0.002 } } };

  test("a search's reported cost is stored and shown on it", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { body: PRICED } }));
    await s.send("Hi");

    expect((await s.thread()).messages[0].search).toMatchObject({ status: "done", costMicroUsd: 7000 });
  });

  test("adds to the thread's total spend, but not to the reply's cost, hit rate or savings", async () => {
    // The same cached reply, once without a search and once with one.
    const usage = { input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 5 };
    const run = async (search: boolean) => {
      const s = await setup();
      await s.saveKey();
      fake = fakeFetch({
        [MESSAGES_URL]: { body: sse(messageStart(usage), textDelta("ok"), messageDelta({}), messageStop) },
        [EXA_URL]: exa({ Hi: { body: PRICED } }),
      });
      await s.send("Hi", search);
      fake.restore();
      const reply = (await s.thread()).messages[1];
      return {
        thread: (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!.thread,
        replyCost: (await s.owner.query(api.inspector.turn, { messageId: reply._id }))!.costMicroUsd,
      };
    };
    const plain = await run(false);
    const searched = await run(true);

    expect(plain.thread.costMicroUsd).toBeGreaterThan(0);
    expect(searched.thread.costMicroUsd).toBe(plain.thread.costMicroUsd + 7000);
    expect(searched.thread.unpricedCalls).toBe(plain.thread.unpricedCalls);
    expect(searched.thread.hitRate).toBe(plain.thread.hitRate);
    expect(searched.thread.savedMicroUsd).toBe(plain.thread.savedMicroUsd);
    expect(searched.replyCost).toBe(plain.replyCost);
  });

  const today = () => new Date().toISOString().slice(0, 10); // no time zone set: UTC days
  const exaLine = async (s: Awaited<ReturnType<typeof setup>>) =>
    (await s.owner.query(api.usage.summary, { today: today() })).models.find((m) => m.model === "exa-search");

  test("shows in the usage page's daily spend and as an exa-search line, even after the thread is deleted", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { body: PRICED } }));
    await s.send("Hi");
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.settle();

    const summary = await s.owner.query(api.usage.summary, { today: today() });
    expect(summary.days.find((d) => d.day === today())).toMatchObject({ costMicroUsd: 7000 });
    expect(await exaLine(s)).toEqual({ model: "exa-search", costMicroUsd: 7000, calls: 1, unpricedCalls: 0 });
  });

  test("counts toward the daily budget", async () => {
    const s = await setup();
    await s.saveKey();
    await s.owner.mutation(api.settings.setDailyBudget, { microUsd: 5000 });
    fake = fakeFetch(fixtures({ Hi: { body: PRICED } }));
    await s.send("Hi");

    expect(await s.owner.query(api.usage.budget, { today: today() })).toMatchObject({ budgetMicroUsd: 5000, spentMicroUsd: 7000 });
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Again" })).rejects.toThrow("Daily budget reached");
  });

  test("a search without a reported cost is an unpriced call", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { body: RESULTS } }));
    await s.send("Hi");

    expect((await s.thread()).messages[0].search).not.toHaveProperty("costMicroUsd");
    expect(await exaLine(s)).toEqual({ model: "exa-search", costMicroUsd: 0, calls: 1, unpricedCalls: 1 });
  });

  test("a failed search adds nothing", async () => {
    const s = await setup();
    await s.saveKey();
    fake = fakeFetch(fixtures({ Hi: { status: 402, body: { requestId: "r3", error: "Out of credits" } } }));
    await s.send("Hi");

    expect((await s.thread()).messages[0].search).toMatchObject({ status: "failed" });
    expect(await exaLine(s)).toBeUndefined();
  });
});
