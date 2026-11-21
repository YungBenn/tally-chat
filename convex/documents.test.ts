/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
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
const PDF = readFileSync(new URL("../test/fixtures/report.pdf", import.meta.url));

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
  const store = (bytes: Uint8Array<ArrayBuffer> | string, type = "application/octet-stream") =>
    t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));
  const attach = async (name: string, bytes: Uint8Array<ArrayBuffer> | string) =>
    owner.action(api.documentActions.extract, { storageId: await store(bytes), name });
  const settle = () => t.finishAllScheduledFunctions(() => {});
  const thread = async () => (await owner.query(api.chat.getThread, { threadId }))!;
  const firstUserText = () => {
    const c = (fake!.requests.at(-1)!.body as { messages: { content: unknown }[] }).messages[0].content;
    return typeof c === "string" ? c : (c as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("");
  };
  return { t, owner, threadId, store, attach, settle, thread, firstUserText };
}

describe("extracting a document", () => {
  test("a text file keeps its text; the upload is removed once read", async () => {
    const s = await setup();
    const storageId = await s.store("name,revenue\nacme,12\n");
    const doc = await s.owner.action(api.documentActions.extract, { storageId, name: "sales.csv" });
    expect(doc).toMatchObject({ name: "sales.csv", tokens: 5 });
    expect(await s.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get("documents", doc.documentId))).toMatchObject({ text: "name,revenue\nacme,12" });
  });

  test("a PDF is read through its text layer", async () => {
    const s = await setup();
    const doc = await s.attach("report.pdf", new Uint8Array(PDF));
    expect(await s.t.run((ctx) => ctx.db.get("documents", doc.documentId))).toMatchObject({ name: "report.pdf", text: "Quarterly revenue grew 12 percent." });
  });

  test("binary files, empty files and documents over the limit are refused", async () => {
    const s = await setup();
    await expect(s.attach("photo.bin", new Uint8Array([0x89, 0x50, 0x00, 0x01]))).rejects.toThrow("Attach a PDF or a text file");
    await expect(s.attach("blank.txt", "  \n ")).rejects.toThrow("blank.txt has no text");
    await expect(s.attach("huge.txt", "x".repeat(400_001))).rejects.toThrow("huge.txt is about 100k tokens; the limit is 100k");
  });

  test("requires the owner", async () => {
    const s = await setup();
    const storageId = await s.store("hi");
    await expect(s.t.action(api.documentActions.extract, { storageId, name: "a.txt" })).rejects.toThrow("Not logged in");
  });
});

describe("sending with documents", () => {
  test("the document's text goes before the message, the same on every request", async () => {
    const s = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } });
    const doc = await s.attach("sales.csv", "name,revenue\nacme,12");
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Who earns most?", documents: [doc.documentId] });
    await s.settle();
    const first = s.firstUserText();
    expect(first).toBe('<document name="sales.csv">\nname,revenue\nacme,12\n</document>\n\nWho earns most?');

    const [user, reply] = (await s.thread()).messages;
    expect(user.text).toBe("Who earns most?");
    expect(user.documents).toEqual([{ name: "sales.csv", tokens: 5 }]);
    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.settle();
    expect(s.firstUserText()).toBe(first);
  });

  test("before its reply is measured, the turn is estimated with the document", async () => {
    const s = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } });
    const doc = await s.attach("notes.txt", "y".repeat(400));
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", documents: [doc.documentId] });
    const view = await s.owner.query(api.inspector.get, { threadId: s.threadId });
    expect(view!.layers.find((l) => l.kind === "turns")).toMatchObject({ tokens: 1 + 100, estimated: true });
    await s.settle();
  });

  test("a document can be sent once, by its owner, and goes with the thread when it is deleted", async () => {
    const s = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } });
    const doc = await s.attach("a.txt", "alpha");
    const otherOwner = await s.t.run((ctx) => ctx.db.insert("users", { email: "other" }));
    const stranger = s.t.withIdentity({ subject: `${otherOwner}|session` });
    const { providerId } = (await s.t.run((ctx) => ctx.db.get("threads", s.threadId)))!;
    const strangerThread = await s.t.run((ctx) =>
      ctx.db.insert("threads", { ownerId: otherOwner, title: "x", providerId, modelId: "claude-sonnet-5-5", systemPromptVersion: 2 }),
    );
    await expect(stranger.mutation(api.chat.send, { threadId: strangerThread, content: "x", documents: [doc.documentId] })).rejects.toThrow("Document not found");

    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Read it", documents: [doc.documentId] });
    await s.settle();
    await expect(s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Again", documents: [doc.documentId] })).rejects.toThrow("already sent");

    // An edit keeps the documents, like it keeps images.
    await s.owner.mutation(api.chat.edit, { messageId: (await s.thread()).messages[0]._id, content: "Read it twice" });
    await s.settle();
    expect(s.firstUserText()).toBe('<document name="a.txt">\nalpha\n</document>\n\nRead it twice');

    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.settle();
    expect(await s.t.run((ctx) => ctx.db.get("documents", doc.documentId))).toBeNull();
  });
});

describe("mentioning a thread", () => {
  // A finished thread with the given turns on its active branch, inserted directly.
  async function threadWith(s: Awaited<ReturnType<typeof setup>>, title: string, contents: string[]) {
    return s.t.run(async (ctx) => {
      const base = (await ctx.db.get("threads", s.threadId))!;
      const id = await ctx.db.insert("threads", {
        ownerId: base.ownerId, title, providerId: base.providerId, modelId: base.modelId, systemPromptVersion: 2, startedAt: Date.UTC(2026, 10, 1),
      });
      const ids: Id<"messages">[] = [];
      for (const [i, content] of contents.entries())
        ids.push(await ctx.db.insert("messages", {
          ownerId: base.ownerId, threadId: id, parentId: ids.at(-1), ancestorIds: [...ids], role: i % 2 ? "assistant" : "user",
          pinned: false, content, status: "done", ...(i % 2 ? { model: "claude-sonnet-5-5" } : {}),
        }));
      await ctx.db.patch("threads", id, { activeLeafId: ids.at(-1) });
      return { id, ids };
    });
  }

  test("sends a frozen copy of the thread's branch, linked back to it", async () => {
    const s = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } });
    const source = await threadWith(s, "Kyoto trip", ["Plan Kyoto", "Day 1: Fushimi Inari"]);
    const doc = await s.owner.mutation(api.documents.fromThread, { threadId: source.id });
    expect(doc.name).toBe("Kyoto trip");
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Shorten it", documents: [doc.documentId] });
    await s.settle();
    expect(s.firstUserText()).toBe(
      '<document name="Kyoto trip">\nConversation from the thread "Kyoto trip", started 2026-11-01.\n\nUser:\nPlan Kyoto\n\n' +
        "Assistant (claude-sonnet-5-5):\nDay 1: Fushimi Inari\n</document>\n\nShorten it",
    );
    expect((await s.thread()).messages[0].documents).toEqual([{ name: "Kyoto trip", tokens: doc.tokens, fromThreadId: source.id }]);

    const stranger = s.t.withIdentity({ subject: `${await s.t.run((ctx) => ctx.db.insert("users", { email: "x" }))}|session` });
    await expect(stranger.mutation(api.documents.fromThread, { threadId: source.id })).rejects.toThrow("Thread not found");
  });

  test("a long thread goes as its condense summary plus later turns; without one it is refused", async () => {
    const s = await setup();
    const long = "z".repeat(400_000);
    const source = await threadWith(s, "Long", [long, "reply", "Next question", "Next answer"]);
    await expect(s.owner.mutation(api.documents.fromThread, { threadId: source.id })).rejects.toThrow("Long is about 100k tokens; the limit is 100k. Condense it first.");

    await s.t.run(async (ctx) => {
      const ownerId = (await ctx.db.get("threads", source.id))!.ownerId;
      await ctx.db.insert("checkpoints", { ownerId, threadId: source.id, coversUpToId: source.ids[1], summary: "They talked at length.", tokens: 5 });
    });
    const doc = await s.owner.mutation(api.documents.fromThread, { threadId: source.id });
    expect(await s.t.run(async (ctx) => (await ctx.db.get("documents", doc.documentId))!.text)).toBe(
      'Conversation from the thread "Long", started 2026-11-01.\n\nSummary of the earlier conversation:\nThey talked at length.\n\n' +
        "User:\nNext question\n\nAssistant (claude-sonnet-5-5):\nNext answer",
    );
  });
});
