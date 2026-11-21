/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch, type Recorded } from "../test/fakeFetch";
import { messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const SEARXNG = "http://searxng:8080";
const searchKey = (q: string) => `GET ${SEARXNG}/search?${new URLSearchParams({ q, format: "json" })}`;
const RESULTS = {
  results: [
    { title: "Convex | All gas", url: "https://www.convex.dev/", content: "Convex is the all-in-one backend." },
    { title: "Convex docs", url: "https://docs.convex.dev/", content: "x".repeat(400) },
  ],
};

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
  const send = async (content: string, search = true) => {
    await owner.mutation(api.chat.send, { threadId, content, search });
    await settle();
  };
  const thread = async () => (await owner.query(api.chat.getThread, { threadId }))!;
  const modelRequests = () => fake!.requests.filter((r) => r.method === "POST").map((r) => r.body as { messages: { role: string; content: unknown }[] });
  const searchRequests = () => fake!.requests.filter((r) => r.method === "GET");
  return { t, owner, threadId, send, settle, thread, modelRequests, searchRequests };
}

const fixtures = (extra: Record<string, Recorded> = {}) => ({
  [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) },
  ...extra,
});
const firstUserText = (body: { messages: { role: string; content: unknown }[] }) => {
  const c = body.messages[0].content;
  return typeof c === "string" ? c : (c as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
};

describe("web search settings", () => {
  test("saves a SearXNG URL without its trailing slash, and empty text clears it", async () => {
    const { owner } = await setup();
    expect((await owner.query(api.settings.get, {})).searchUrl).toBe("");
    await owner.mutation(api.settings.setSearchUrl, { url: " http://searxng:8080/ " });
    expect((await owner.query(api.settings.get, {})).searchUrl).toBe("http://searxng:8080");
    await owner.mutation(api.settings.setSearchUrl, { url: "" });
    expect((await owner.query(api.settings.get, {})).searchUrl).toBe("");
  });

  test("rejects anything but an http(s) URL", async () => {
    const { owner } = await setup();
    for (const url of ["searxng:8080", "ftp://searxng", "http://user:pass@searxng"])
      await expect(owner.mutation(api.settings.setSearchUrl, { url })).rejects.toThrow("Enter a URL like http://searxng:8080");
  });

  test("searching needs a URL first", async () => {
    const { owner, threadId } = await setup();
    await expect(owner.mutation(api.chat.send, { threadId, content: "Hi", search: true })).rejects.toThrow("Set a SearXNG URL in Settings");
  });
});

describe("searching before a reply", () => {
  test("sends the results with the message, and shows them as sources", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("What is Convex?")]: { body: RESULTS } }));
    await s.send("What is Convex?");

    // The private SearXNG host needs no separate allowlist entry: the owner named it.
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
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("What is Convex?")]: { body: RESULTS } }));
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
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("Hi")]: { body: RESULTS } }));
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", search: true });
    const view = await s.owner.query(api.inspector.get, { threadId: s.threadId });
    expect(view!.layers.find((l) => l.kind === "turns")).toMatchObject({ tokens: 1 + 900, estimated: true });
    await s.settle();
  });

  test("deleting the thread removes its stored searches", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("Hi")]: { body: RESULTS } }));
    await s.send("Hi");
    expect(await s.t.run((ctx) => ctx.db.query("searches").collect())).toHaveLength(1);
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.settle();
    expect(await s.t.run((ctx) => ctx.db.query("searches").collect())).toHaveLength(0);
  });

  test("a failed search still gets a reply, told that the search failed", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("Hi")]: { status: 502, body: "Bad Gateway" } }));
    await s.send("Hi");

    expect(firstUserText(s.modelRequests()[0])).toBe('Hi\n\n<web_search query="Hi">\nThe web search failed (HTTP 502), so there are no results.\n</web_search>');
    const [user, reply] = (await s.thread()).messages;
    expect(user.search).toEqual({ status: "failed", results: [], error: "HTTP 502" });
    expect(reply.status).toBe("done");
  });

  test("an edit of a searched message searches again for the new text", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setSearchUrl, { url: SEARXNG });
    fake = fakeFetch(fixtures({ [searchKey("What is Convex?")]: { body: RESULTS }, [searchKey("What is Bun?")]: { body: { results: [] } } }));
    await s.send("What is Convex?");
    await s.owner.mutation(api.chat.edit, { messageId: (await s.thread()).messages[0]._id, content: "What is Bun?" });
    await s.settle();

    expect(s.searchRequests()).toHaveLength(2);
    expect(firstUserText(s.modelRequests()[1])).toBe('What is Bun?\n\n<web_search query="What is Bun?">\nThe web search returned no results.\n</web_search>');
  });
});
