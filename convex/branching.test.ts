/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

// Each provider call replies with the last user message echoed, so the request history is visible.
async function setup() {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk-ant"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com", apiKeyEncrypted, detected: "",
      keyCheckedAt: 0, models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  let n = 0;
  fake = fakeFetch({
    [MESSAGES_URL]: {
      respond: (init) => {
        const { messages } = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        return new Response(sse(textDelta(`re: ${messages.at(-1)!.content} #${++n}`), messageStop));
      },
    },
  });
  const run = async <T>(p: Promise<T>) => {
    const out = await p;
    await t.finishAllScheduledFunctions(() => {});
    return out;
  };
  const branch = async () => (await owner.query(api.chat.getThread, { threadId }))!.messages;
  const texts = async () => (await branch()).map((m) => m.text);
  const sentHistories = () => fake!.requests.map((r) => (r.body as { messages: { content: string }[] }).messages.map((m) => m.content));
  return { t, owner, threadId, run, branch, texts, sentHistories };
}

describe("retry", () => {
  test("adds a new reply beside the old one and makes it active", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" }));
    const [, reply] = await s.branch();
    await s.run(s.owner.mutation(api.chat.retry, { messageId: reply._id }));

    expect(await s.texts()).toEqual(["Q1", "re: Q1 #2"]);
    const [, retried] = await s.branch();
    expect(retried.siblingIds).toEqual([reply._id, retried._id]);
    expect(s.sentHistories()[1]).toEqual(["Q1"]);
  });

  test("cannot retry a user message, or while a reply is streaming", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" });
    const [question, reply] = await s.branch();
    await expect(s.owner.mutation(api.chat.retry, { messageId: question._id })).rejects.toThrow("Only replies");
    await expect(s.owner.mutation(api.chat.retry, { messageId: reply._id })).rejects.toThrow("Wait for the reply");
    await s.t.finishAllScheduledFunctions(() => {});
  });
});

describe("edit", () => {
  test("forks at the edited message: a new version with its own reply, earlier turns kept", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" }));
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q2" }));
    const q2 = (await s.branch())[2];
    await s.run(s.owner.mutation(api.chat.edit, { messageId: q2._id, content: "Q2 edited" }));

    expect(await s.texts()).toEqual(["Q1", "re: Q1 #1", "Q2 edited", "re: Q2 edited #3"]);
    const edited = (await s.branch())[2];
    expect(edited.siblingIds).toEqual([q2._id, edited._id]);
    expect(s.sentHistories()[2]).toEqual(["Q1", "re: Q1 #1", "Q2 edited"]);
  });

  test("editing the first message starts a new root", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" }));
    const [q1] = await s.branch();
    await s.run(s.owner.mutation(api.chat.edit, { messageId: q1._id, content: "Q1 again" }));
    expect(await s.texts()).toEqual(["Q1 again", "re: Q1 again #2"]);
    expect((await s.branch())[0].siblingIds).toHaveLength(2);
  });
});

describe("switching branches", () => {
  test("switching to an older version follows it down to its newest leaf, and sending continues there", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" }));
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q2" }));
    const q1 = (await s.branch())[0];
    await s.run(s.owner.mutation(api.chat.edit, { messageId: q1._id, content: "Q1b" }));
    expect(await s.texts()).toEqual(["Q1b", "re: Q1b #3"]);

    await s.owner.mutation(api.chat.switchBranch, { messageId: q1._id });
    expect(await s.texts()).toEqual(["Q1", "re: Q1 #1", "Q2", "re: Q2 #2"]);

    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q3" }));
    expect(s.sentHistories()[3]).toEqual(["Q1", "re: Q1 #1", "Q2", "re: Q2 #2", "Q3"]);
  });

  test("abandoned branches never appear in any provider request", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "keep" }));
    const [, bad] = await s.branch();
    await s.run(s.owner.mutation(api.chat.retry, { messageId: bad._id }));
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "next" }));
    const [q] = await s.branch();
    await s.run(s.owner.mutation(api.chat.edit, { messageId: q._id, content: "fresh" }));
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "last" }));

    expect(s.sentHistories().at(-1)).toEqual(["fresh", "re: fresh #4", "last"]);
    for (const history of s.sentHistories().slice(2)) expect(history).not.toContain("re: keep #1");
  });
});

describe("append-only", () => {
  test("retry, edit and switching never update or delete an existing message", async () => {
    const s = await setup();
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q1" }));
    await s.run(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Q2" }));
    const snapshot = await s.t.run((ctx) => ctx.db.query("messages").collect());

    const [q1, r1, q2, r2] = await s.branch();
    await s.run(s.owner.mutation(api.chat.retry, { messageId: r2._id }));
    await s.run(s.owner.mutation(api.chat.edit, { messageId: q2._id, content: "Q2b" }));
    await s.owner.mutation(api.chat.switchBranch, { messageId: q1._id });
    await s.owner.mutation(api.chat.switchBranch, { messageId: r1._id });

    const after = await s.t.run((ctx) => ctx.db.query("messages").collect());
    const byId = new Map(after.map((m) => [m._id as Id<"messages">, m]));
    for (const before of snapshot) expect(byId.get(before._id)).toEqual(before);
    expect(after).toHaveLength(snapshot.length + 3); // a retried reply, an edited question and its reply
  });
});
