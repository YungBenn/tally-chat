/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageStop, oaiDelta, oaiDone, oaiFinish, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const OPENAI_URL = "POST https://api.openai.com/v1/chat/completions";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const tag = (line: string) => `<current_date>${line}</current_date>`;

async function setup(style: "anthropic" | "openai-compatible" = "anthropic") {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-26T10:00:00Z");
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const anthropic = style === "anthropic";
  const modelId = anthropic ? "claude-sonnet-5-5" : "gpt-5";
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId,
      name: "P",
      apiStyle: style,
      baseUrl: anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1",
      apiKeyEncrypted,
      detected: "",
      keyCheckedAt: 0,
      models: [{ id: modelId, displayName: "M", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId });
  fake = fakeFetch(
    anthropic
      ? { [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } }
      : { [OPENAI_URL]: { body: oaiDelta("ok") + oaiFinish({ prompt_tokens: 1, completion_tokens: 1 }) + oaiDone } },
  );
  const settle = () => t.finishAllScheduledFunctions(() => {});
  const send = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await settle();
  };
  // The text of every user message in the latest request, in order.
  const userTexts = () => {
    const body = fake!.requests.at(-1)!.body as { messages: { role: string; content: unknown }[] };
    return body.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join(""),
      );
  };
  const messages = async () => (await owner.query(api.chat.getThread, { threadId }))!.messages;
  return { t, owner, threadId, send, settle, userTexts, messages };
}

describe("date tag", () => {
  test("the first message carries the date in the owner's timezone", async () => {
    const s = await setup();
    await s.owner.mutation(api.settings.setTimeZone, { timeZone: "Pacific/Auckland" });
    at("2026-11-26T20:00:00Z"); // already Friday 27 November in Auckland
    await s.send("What is new?");
    expect(s.userTexts()).toEqual([`${tag("Friday, 27 November 2026")}\n\nWhat is new?`]);
  });

  test("UTC is used when no timezone is set", async () => {
    const s = await setup();
    at("2026-11-26T23:30:00Z");
    await s.send("Hi");
    expect(s.userTexts()).toEqual([`${tag("Thursday, 26 November 2026")}\n\nHi`]);
  });

  test("a same-day follow-up has no tag; the next local day gets one", async () => {
    const s = await setup();
    await s.send("one");
    at("2026-11-26T22:00:00Z");
    await s.send("two");
    expect(s.userTexts()).toEqual([`${tag("Thursday, 26 November 2026")}\n\none`, "two"]);
    at("2026-11-27T00:30:00Z");
    await s.send("three");
    expect(s.userTexts()).toEqual([
      `${tag("Thursday, 26 November 2026")}\n\none`,
      "two",
      `${tag("Friday, 27 November 2026")}\n\nthree`,
    ]);
  });

  test("an edit decides against the nearest earlier user message on its own branch", async () => {
    const s = await setup();
    await s.send("one");
    await s.send("two");
    at("2026-11-27T09:00:00Z");
    await s.send("three");
    const [, , two] = await s.messages();
    await s.owner.mutation(api.chat.edit, { messageId: two._id, content: "two, edited" });
    await s.settle();
    // Forked on the 27th from a branch whose last date is the 26th, so it carries a date.
    expect(s.userTexts()).toEqual([
      `${tag("Thursday, 26 November 2026")}\n\none`,
      `${tag("Friday, 27 November 2026")}\n\ntwo, edited`,
    ]);
    // Editing the first message starts a branch with nothing earlier.
    const [one] = await s.messages();
    await s.owner.mutation(api.chat.edit, { messageId: one._id, content: "one, edited" });
    await s.settle();
    expect(s.userTexts()).toEqual([`${tag("Friday, 27 November 2026")}\n\none, edited`]);
  });

  test("changing the timezone leaves earlier messages' request bytes unchanged", async () => {
    const s = await setup();
    await s.send("one");
    const before = s.userTexts();
    await s.owner.mutation(api.settings.setTimeZone, { timeZone: "Pacific/Auckland" });
    await s.send("two");
    expect(s.userTexts().slice(0, 1)).toEqual(before);
  });

  test("a message stored before the change renders as before", async () => {
    const s = await setup();
    await s.send("old");
    const [old] = await s.messages();
    await s.t.run((ctx) => ctx.db.patch("messages", old._id, { date: undefined }));
    await s.send("new");
    expect(s.userTexts()[0]).toBe("old");
  });

  test("OpenAI-compatible requests carry the tag", async () => {
    const s = await setup("openai-compatible");
    await s.send("Hi");
    const body = fake!.requests[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages.find((m) => m.role === "user")!.content).toBe(`${tag("Thursday, 26 November 2026")}\n\nHi`);
  });

  test("before its reply is measured, the turn is estimated with the tag", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "x".repeat(40) });
    const view = await s.owner.query(api.inspector.get, { threadId: s.threadId });
    // 40 characters = 10 tokens; the 57-character tag block = 15.
    expect(view!.layers.find((l) => l.kind === "turns")).toMatchObject({ tokens: 25, estimated: true });
    await s.settle();
  });
});
