/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { gate, gatedStream, messageDelta, messageStart, messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
// Waits on scheduled functions, which run on the real clock: a deadline only a broken test reaches.
const SCHEDULED = { timeout: 30_000 };
const usage = { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 1 };

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
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
  const rows = <T extends "messages" | "messageAncestors" | "checkpoints" | "dailyUsage" | "streams" | "threadStates">(table: T) => t.run((ctx) => ctx.db.query(table).collect());
  return { t, owner, ownerId, threadId, rows };
}

describe("deleting a thread", () => {
  test("removes the thread, its messages and their ancestors, checkpoints, stream data and state; rollups keep its spend", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(messageStart(usage), textDelta("Hi"), messageDelta({ output_tokens: 20 }), messageStop) } });
    for (const content of ["one", "two"]) {
      await s.owner.mutation(api.chat.send, { threadId: s.threadId, content });
      await s.t.finishAllScheduledFunctions(() => {});
    }
    const [, reply] = await s.rows("messages");
    await s.t.run((ctx) => ctx.db.insert("checkpoints", { ownerId: s.ownerId, threadId: s.threadId, coversUpToId: reply._id, summary: "S", tokens: 1 }));
    expect(await s.rows("streams")).toEqual([]); // finished replies leave no stream row
    await s.t.run((ctx) => ctx.db.insert("streams", { messageId: reply._id, text: "left over" }));
    const rollups = await s.rows("dailyUsage");
    expect(rollups.length).toBe(3);
    expect((await s.rows("messageAncestors")).length).toBe(4);

    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    expect(await s.owner.query(api.chat.listThreads, {})).toEqual([]); // gone from every device at once
    expect(await s.owner.query(api.chat.getThread, { threadId: s.threadId })).toBeNull();
    await s.t.finishAllScheduledFunctions(() => {});

    expect(await s.rows("messages")).toEqual([]);
    expect(await s.rows("messageAncestors")).toEqual([]);
    expect(await s.rows("checkpoints")).toEqual([]);
    expect(await s.rows("streams")).toEqual([]);
    expect(await s.rows("threadStates")).toEqual([]);
    expect(await s.rows("dailyUsage")).toEqual(rollups);
  });

  test("a reply that is streaming is stopped first, and its billed usage still reaches the rollups", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const s = await setup();
    const g = gate();
    let aborted = false;
    fake = fakeFetch({
      [MESSAGES_URL]: {
        respond: (init) => {
          init?.signal?.addEventListener("abort", () => (aborted = true));
          return new Response(gatedStream([messageStart(usage), textDelta("Hel"), g, textDelta("lo")], init?.signal));
        },
      },
    });
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi" });
    await g.reached;

    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    expect(await s.owner.query(api.chat.listThreads, {})).toEqual([]);
    // The first purge pass flags the stop and keeps the reply until it finalizes.
    await vi.waitFor(async () => expect((await s.rows("messages")).find((m) => m.role === "assistant")?.stopRequested).toBe(true), SCHEDULED);
    vi.setSystemTime(Date.now() + 200);
    g.release();

    await vi.waitFor(async () => expect(await s.rows("messages")).toEqual([]), SCHEDULED);
    expect(aborted).toBe(true);
    expect(await s.rows("streams")).toEqual([]);
    const rollups = await s.rows("dailyUsage");
    expect(rollups).toHaveLength(3);
    for (const row of rollups) expect(row).toMatchObject({ calls: 1, inputTokens: 100 });
  });

  test("a reply queued but not started is closed without calling the provider", async () => {
    const s = await setup();
    fake = fakeFetch({});
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi" });
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await vi.waitFor(async () => {
      await s.t.finishAllScheduledFunctions(() => {});
      expect(await s.rows("messages")).toEqual([]);
    }, SCHEDULED);
    expect(fake.requests).toEqual([]);
    expect(await s.rows("streams")).toEqual([]);
  });

  test("requires the owner", async () => {
    const s = await setup();
    await expect(s.t.mutation(api.chat.deleteThread, { threadId: s.threadId })).rejects.toThrow("Not logged in");
  });
});
