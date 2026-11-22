/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageStop, sse, textDelta } from "../test/sse";
import { api, internal } from "./_generated/api";
import { STUCK_REPLY_MS } from "./chat";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
// Waits on scheduled functions, which run on the real clock: a deadline only a broken test reaches.
const SCHEDULED = { timeout: 30_000 };
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

// A reply whose generating action died: still "streaming", with some text in its stream.
async function setupStuckReply() {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted, detected: "",
      keyCheckedAt: 0, models: [{ id: "claude-sonnet-5-5", displayName: "S", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const replyId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("messages", {
      ownerId, threadId, ancestorIds: [], role: "user", pinned: false, content: "Hi", status: "done",
    });
    const id = await ctx.db.insert("messages", {
      ownerId, threadId, parentId: userId, ancestorIds: [userId], role: "assistant", pinned: false, content: "",
      status: "streaming", model: "claude-sonnet-5-5", providerId,
    });
    await ctx.db.insert("streams", { messageId: id, text: "Partial answ" });
    await ctx.db.patch("threads", threadId, { activeLeafId: id, titleRequested: true });
    return id;
  });
  const reply = () => t.run((ctx) => ctx.db.get("messages", replyId));
  const streams = () => t.run((ctx) => ctx.db.query("streams").collect());
  return { t, owner, threadId, reply, streams };
}

describe("stuck reply sweeper", () => {
  test("leaves replies younger than the action timeout alone", async () => {
    const s = await setupStuckReply();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    expect(await s.t.mutation(internal.chat.sweepStuckReplies, {})).toBe(0);
    expect(await s.reply()).toMatchObject({ status: "streaming" });
  });

  test("closes an older one as an error, keeping its text, so the thread works again", async () => {
    const s = await setupStuckReply();
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Again" })).rejects.toThrow("Wait for the reply");

    vi.setSystemTime(Date.now() + STUCK_REPLY_MS + 60_000);
    expect(await s.t.mutation(internal.chat.sweepStuckReplies, {})).toBe(1);
    expect(await s.reply()).toMatchObject({ status: "error", content: "Partial answ", error: "The reply was interrupted" });
    expect(await s.streams()).toEqual([]);

    fake = fakeFetch({ "POST https://api.anthropic.com/v1/messages": { body: sse(textDelta("ok"), messageStop) } });
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Again" });
    await s.t.finishAllScheduledFunctions(() => {});
    const last = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.at(-1)!;
    expect(last).toMatchObject({ status: "done", text: "ok" });
  });

  test("a thread delete waiting on a stuck reply finishes once the sweeper closes it", async () => {
    const s = await setupStuckReply();
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await vi.waitFor(async () => expect((await s.reply())?.stopRequested).toBe(true), SCHEDULED);
    expect(await s.reply()).not.toBeNull(); // still waiting on it

    vi.setSystemTime(Date.now() + STUCK_REPLY_MS + 60_000);
    await s.t.mutation(internal.chat.sweepStuckReplies, {});
    await vi.waitFor(async () => expect(await s.reply()).toBeNull(), SCHEDULED);
  });
});
