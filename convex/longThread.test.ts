/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import {
  messageDelta,
  messageStart,
  messageStop,
  sse,
  textDelta,
} from "../test/sse";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ancestorIds, insertMessage } from "./lib/ancestors";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "160.79.104.10", family: 4 }],
}));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

// The dev deployment's "Perf 600 messages" thread: 600 messages, about 650 characters each.
const MESSAGES = 600;
const text = (i: number) => `Message ${i}. ${"lorem ipsum dolor sit amet ".repeat(24).trim()}`;
const claudeExport = [
  {
    uuid: "long",
    name: "Long thread",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    account: { uuid: "acc" },
    chat_messages: Array.from({ length: MESSAGES }, (_, i) => ({
      uuid: `m${i}`,
      sender: i % 2 === 0 ? "human" : "assistant",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      text: text(i),
      attachments: [],
      files: [],
      content: [{ type: "text", text: text(i) }],
    })),
  },
];

// Every function runs under a quarter of Convex's 16 MiB read limit: reads grow linearly with the
// branch, so a thread four times as long still fits. Storing each message's ancestors on the
// message made them quadratic, and getThread failed at about 650 messages.
test("a 600-message thread opens, inspects, sends and condenses well within Convex's read limit", async () => {
  const t = convexTest({ schema, modules, transactionLimits: { bytesRead: 4 * 1024 * 1024 } });
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const apiKeyEncrypted = await t.run(() => encryptSecret("sk"));
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId,
      name: "A",
      apiStyle: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted,
      detected: "",
      keyCheckedAt: 0,
      models: [{ id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify(claudeExport)], { type: "application/json" })),
  );
  await owner.mutation(api.imports.start, {
    storageId,
    fileName: "conversations.json",
    providerId,
    modelId: "claude-sonnet-5-5",
  });
  await t.finishAllScheduledFunctions(() => {});
  const threadId = (await owner.query(api.chat.listThreads, {}))[0]._id;
  fake = fakeFetch({
    "POST https://api.anthropic.com/v1/messages": {
      respond: () =>
        new Response(
          sse(
            messageStart({ input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 }),
            textDelta("A summary or a reply."),
            messageDelta({}),
            messageStop,
          ),
        ),
    },
  });

  const view = await owner.query(api.chat.getThread, { threadId });
  expect(view?.messages).toHaveLength(MESSAGES);
  expect(view?.messages[MESSAGES - 1].text).toBe(text(MESSAGES - 1));
  expect((await owner.query(api.inspector.get, { threadId }))?.layers.length).toBeGreaterThan(1);

  // Send runs the generate input query, finalize and the condense check over the whole branch.
  await owner.mutation(api.chat.send, { threadId, content: "One more question" });
  await t.finishAllScheduledFunctions(() => {});
  const after = await owner.query(api.chat.getThread, { threadId });
  expect(after?.messages.slice(-2).map((m) => [m.role, m.text, m.error])).toEqual([
    ["user", "One more question", undefined],
    ["assistant", "A summary or a reply.", undefined],
  ]);
  const reply = after!.messages[MESSAGES + 1]._id;
  expect(await owner.query(api.inspector.modelEstimates, { threadId, retryOf: reply, now: Date.now(), draftTokens: 0, maxOutputTokens: 1000 })).not.toEqual([]);

  await owner.mutation(api.condense.condenseNow, { threadId });
  await t.finishAllScheduledFunctions(() => {});
  expect((await owner.query(api.chat.getThread, { threadId }))?.checkpoint?.summary).toBe(
    "A summary or a reply.",
  );
}, 120_000);

test("ancestors move off messages and back on mixed data without changing any branch, and reruns change nothing", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { email: "owner" }));
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const providerId = await t.run((ctx) =>
    ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted: "", detected: "", keyCheckedAt: 0, models: [],
    }),
  );
  const threadId = await t.run((ctx) =>
    ctx.db.insert("threads", { ownerId, title: "Old", providerId, modelId: "m", systemPromptVersion: 1 }),
  );
  // A thread from before phase 12: 600 messages with their ancestors inline, plus a retry of the
  // last reply.
  await t.run(async (ctx) => {
    const ids: Id<"messages">[] = [];
    for (let i = 0; i < MESSAGES; i++)
      ids.push(
        await ctx.db.insert("messages", {
          ownerId, threadId, parentId: ids.at(-1), ancestorIds: [...ids], role: i % 2 ? "assistant" : "user",
          pinned: false, content: text(i), status: "done",
        }),
      );
    const retry = await ctx.db.insert("messages", {
      ownerId, threadId, parentId: ids.at(-2), ancestorIds: ids.slice(0, -1), role: "assistant",
      pinned: false, content: "retried", status: "done",
    });
    await ctx.db.patch("threads", threadId, { activeLeafId: retry });
  });
  const before = await owner.query(api.chat.getThread, { threadId });
  expect(before?.messages).toHaveLength(MESSAGES);
  expect(before?.messages.at(-1)).toMatchObject({ text: "retried", siblingIds: [expect.anything(), expect.anything()] });

  // Mixed data: a reply written by the new code after the deploy, before the migration ran.
  await t.run(async (ctx) => {
    const leaf = (await ctx.db.get("messages", before!.messages.at(-1)!._id))!;
    const id = await insertMessage(
      ctx,
      { ownerId, threadId, role: "user", pinned: false, content: "after deploy", status: "done" },
      [...(await ancestorIds(ctx, leaf)), leaf._id],
    );
    await ctx.db.patch("threads", threadId, { activeLeafId: id });
  });
  const mixed = await owner.query(api.chat.getThread, { threadId });
  expect(mixed?.messages).toHaveLength(MESSAGES + 1);
  const run = async (migration: typeof internal.migrations.moveMessageAncestors) => {
    for (let i = 0; i < 2; i++) {
      await t.mutation(migration, {});
      await t.finishAllScheduledFunctions(() => {});
    }
  };
  const inline = () =>
    t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.ancestorIds !== undefined).length);

  await run(internal.migrations.moveMessageAncestors);
  expect(await owner.query(api.chat.getThread, { threadId })).toEqual(mixed);
  expect(await inline()).toBe(0);
  expect(await t.run(async (ctx) => (await ctx.db.query("messageAncestors").collect()).length)).toBe(MESSAGES + 2);

  // Rolling back to code from before phase 12 needs every message's ancestors inline again.
  await run(internal.migrations.restoreMessageAncestors);
  expect(await inline()).toBe(MESSAGES + 2);
  const paths = await t.run(async (ctx) =>
    Promise.all(
      (await ctx.db.query("messageAncestors").collect()).map(async (row) => [
        row.ancestorIds,
        (await ctx.db.get("messages", row.messageId))!.ancestorIds,
      ]),
    ),
  );
  for (const [row, onMessage] of paths) expect(onMessage).toEqual(row);
  expect(await owner.query(api.chat.getThread, { threadId })).toEqual(mixed);

  await run(internal.migrations.moveMessageAncestors);
  expect(await inline()).toBe(0);
  expect(await owner.query(api.chat.getThread, { threadId })).toEqual(mixed);
}, 120_000);

// Messages can be large (long replies, pasted documents): a batch of whole messages must stay
// under Convex's 16 MiB read limit however big they are.
test("the ancestor migrations stay within the read limit on large messages", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const big = "x".repeat(400_000);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { email: "owner" });
    const providerId = await ctx.db.insert("providers", {
      ownerId, name: "A", apiStyle: "anthropic", baseUrl: "https://api.anthropic.com",
      apiKeyEncrypted: "", detected: "", keyCheckedAt: 0, models: [],
    });
    const threadId = await ctx.db.insert("threads", {
      ownerId, title: "Big", providerId, modelId: "m", systemPromptVersion: 1,
    });
    return { ownerId, threadId };
  });
  // Stored the pre-phase-12 way: ancestors inline. 60 x 400 KB is well over 16 MiB.
  let parent: Id<"messages"> | undefined;
  const path: Id<"messages">[] = [];
  for (let i = 0; i < 60; i++) {
    parent = await t.run((ctx) =>
      ctx.db.insert("messages", {
        ...ids, role: i % 2 ? "assistant" : "user", pinned: false, content: big, status: "done",
        parentId: parent, ancestorIds: [...path],
      }),
    );
    path.push(parent);
  }
  const run = async (migration: typeof internal.migrations.moveMessageAncestors) => {
    await t.mutation(migration, {});
    await t.finishAllScheduledFunctions(() => {});
  };
  // Counted 20 at a time, since all 60 at once would break the limit here too.
  const inline = async () => {
    let n = 0;
    for (let i = 0; i < path.length; i += 20)
      n += await t.run(async (ctx) => {
        const ms = await Promise.all(path.slice(i, i + 20).map((id) => ctx.db.get("messages", id)));
        return ms.filter((m) => m?.ancestorIds !== undefined).length;
      });
    return n;
  };

  expect(await inline()).toBe(60);
  await run(internal.migrations.moveMessageAncestors);
  expect(await inline()).toBe(0);
  await run(internal.migrations.restoreMessageAncestors);
  expect(await inline()).toBe(60);
  const last = await t.run(async (ctx) => (await ctx.db.get("messages", path[59]))!.ancestorIds);
  expect(last).toEqual(path.slice(0, 59));
}, 120_000);
