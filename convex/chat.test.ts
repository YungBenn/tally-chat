/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { gate, gatedStream, messageStop, sse, streamError, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const KEY = "sk-ant-chat-test";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

async function setup(baseUrl = "https://api.anthropic.com") {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret(KEY));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "Anthropic", apiStyle: "anthropic", baseUrl, apiKeyEncrypted, detected: "Anthropic", keyCheckedAt: 0,
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }, { id: "claude-old", displayName: "Old", hidden: true }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  return { t, owner, providerId, threadId };
}

const reply = (...texts: string[]) => ({ body: sse(...texts.map(textDelta), messageStop), headers: { "content-type": "text/event-stream" } });
const lastAssistant = async (owner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>, threadId: Id<"threads">) =>
  (await owner.query(api.chat.getThread, { threadId })).messages.at(-1)!;

describe("threads", () => {
  test("a thread needs a visible model of the owner's provider", async () => {
    const { owner, providerId } = await setup();
    await expect(owner.mutation(api.chat.createThread, { providerId, modelId: "claude-old" })).rejects.toThrow("Model not available");
    await expect(owner.mutation(api.chat.createThread, { providerId, modelId: "nope" })).rejects.toThrow("Model not available");
  });

  test("requires the owner", async () => {
    const { t, threadId } = await setup();
    await expect(t.query(api.chat.getThread, { threadId })).rejects.toThrow("Not logged in");
    await expect(t.mutation(api.chat.send, { threadId, content: "hi" })).rejects.toThrow("Not logged in");
  });
});

describe("sending a message", () => {
  test("returns immediately with the user message and a streaming reply", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hi") });
    await owner.mutation(api.chat.send, { threadId, content: "  Hello there  " });
    const thread = await owner.query(api.chat.getThread, { threadId });
    expect(thread.title).toBe("Hello there");
    expect(thread.messages.map((m) => [m.role, m.status, m.text])).toEqual([
      ["user", "done", "Hello there"],
      ["assistant", "streaming", ""],
    ]);
    await t.finishAllScheduledFunctions(() => {});
  });

  test("streams the reply through the guard with the system prompt at the thread's version", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Hello", ", ", "world") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});

    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "done", text: "Hello, world" });
    const [request] = fake.requests;
    expect(request.headers["x-api-key"]).toBe(KEY);
    expect(request.body).toMatchObject({
      model: "claude-sonnet-5-5",
      stream: true,
      system: SYSTEM_PROMPTS[1],
      messages: [{ role: "user", content: "Hi" }],
    });
  });

  test("later turns send the whole branch and store ancestorIds", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("One") });
    await owner.mutation(api.chat.send, { threadId, content: "First" });
    await t.finishAllScheduledFunctions(() => {});
    await owner.mutation(api.chat.send, { threadId, content: "Second" });
    await t.finishAllScheduledFunctions(() => {});

    expect(fake.requests[1].body).toMatchObject({
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "One" },
        { role: "user", content: "Second" },
      ],
    });
    const ids = (await owner.query(api.chat.getThread, { threadId })).messages.map((m) => m._id);
    const leaf = await t.run((ctx) => ctx.db.get("messages", ids[3]));
    expect(leaf!.ancestorIds).toEqual(ids.slice(0, 3));
  });

  test("cannot send while a reply is streaming", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("One") });
    await owner.mutation(api.chat.send, { threadId, content: "First" });
    await expect(owner.mutation(api.chat.send, { threadId, content: "Again" })).rejects.toThrow("Wait for the reply");
    await t.finishAllScheduledFunctions(() => {});
  });

  test("a private provider address is refused by the guard and the reply errors", async () => {
    const { t, owner, threadId } = await setup("https://10.0.0.5");
    fake = fakeFetch({});
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", error: expect.stringContaining("private address") });
    expect(fake.requests).toEqual([]);
  });
});

describe("streaming, reload and stop", () => {
  test("mid-stream reads show the text so far; stop aborts the request and keeps what streamed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, owner, threadId } = await setup();
    const [g1, g2] = [gate(), gate()];
    let aborted = false;
    fake = fakeFetch({
      [MESSAGES_URL]: {
        respond: (init) => {
          init?.signal?.addEventListener("abort", () => (aborted = true));
          return new Response(gatedStream([textDelta("Hello "), g1, textDelta("world"), g2, textDelta("!"), textDelta(" more")], init?.signal));
        },
      },
    });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });

    await vi.waitFor(() => expect(g1.reached).toBe(true));
    vi.setSystemTime(Date.now() + 200); // past the 100 ms flush interval
    g1.release();
    await vi.waitFor(() => expect(g2.reached).toBe(true));
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "streaming", text: "Hello world" });

    const { _id } = await lastAssistant(owner, threadId);
    await owner.mutation(api.chat.stop, { messageId: _id });
    vi.setSystemTime(Date.now() + 200);
    g2.release();
    await t.finishInProgressScheduledFunctions();

    expect(aborted).toBe(true);
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "stopped", text: "Hello world!" });
  });

  test("a provider error marks the reply error and keeps what streamed", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("Partial"), streamError("Overloaded")) } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", text: "Partial", error: "Provider error: Overloaded" });
  });

  test("an HTTP error from the provider is reported", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { status: 529, body: { error: { message: "Overloaded" } } } });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await lastAssistant(owner, threadId)).toMatchObject({ status: "error", error: "Provider error 529: Overloaded" });
  });

  test("content never changes after the final status is written", async () => {
    const { t, owner, threadId } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: reply("Final") });
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});
    const { _id } = await lastAssistant(owner, threadId);

    await t.mutation(internal.chat.finalize, { messageId: _id, status: "error", content: "Rewritten", pending: "" });
    await owner.mutation(api.chat.stop, { messageId: _id });
    const row = await t.run((ctx) => ctx.db.get("messages", _id));
    expect(row).toMatchObject({ status: "done", content: "Final" });
    expect(row!.stopRequested).toBeUndefined();
  });
});
