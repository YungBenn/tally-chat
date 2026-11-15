/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import chatgptExport from "../test/fixtures/chatgpt-conversations.json";
import claudeExport from "../test/fixtures/claude-conversations.json";
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
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "160.79.104.10", family: 4 }],
}));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

async function setup() {
  const t = convexTest(schema, modules);
  persistentTextStreaming.register(t);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "owner" }),
  );
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
      models: [
        { id: "claude-sonnet-5-5", displayName: "Sonnet", hidden: false },
        { id: "claude-haiku-5-5", displayName: "Haiku", hidden: false },
      ],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const upload = async (body: unknown, fileName = "conversations.json") => {
    const storageId = await t.run((ctx) =>
      ctx.storage.store(
        new Blob([JSON.stringify(body)], { type: "application/json" }),
      ),
    );
    const importId = await owner.mutation(api.imports.start, {
      storageId,
      fileName,
      providerId,
      modelId: "claude-sonnet-5-5",
    });
    await t.finishAllScheduledFunctions(() => {});
    return { importId, storageId };
  };
  const all = <T extends "threads" | "messages" | "dailyUsage" | "sideJobs">(
    table: T,
  ) => t.run((ctx) => ctx.db.query(table).collect());
  const view = (threadId: Id<"threads">) =>
    owner.query(api.chat.getThread, { threadId });
  return { t, owner, ownerId, providerId, upload, all, view };
}

describe("importing a ChatGPT export", () => {
  test("each conversation becomes a thread with its title, date, branches and placeholders", async () => {
    const s = await setup();
    const { storageId } = await s.upload(chatgptExport);
    const [job] = await s.owner.query(api.imports.list, {});
    expect(job).toMatchObject({
      source: "chatgpt",
      status: "done",
      total: 2,
      imported: 2,
      skipped: 0,
    }); // the system-only one is left out
    expect(await s.t.run((ctx) => ctx.storage.get(storageId))).toBeNull(); // the upload is deleted

    const threads = await s.all("threads");
    const dates = threads.find(
      (th) => th.importedFrom?.externalId === "conv-a",
    )!;
    expect(dates).toMatchObject({
      title: "Parsing dates",
      startedAt: 1700000000500,
      providerId: s.providerId,
      modelId: "claude-sonnet-5-5",
      importedFrom: { source: "chatgpt", externalId: "conv-a" },
      titleRequested: true,
    });
    const untitled = threads.find(
      (th) => th.importedFrom?.externalId === "conv-b",
    )!;
    expect(untitled.title).toMatch(/^Turn 1 question lorem ipsum/); // no export title: the first message's start
    // The sidebar orders by the original dates.
    expect(
      (await s.owner.query(api.chat.listThreads, {})).map((r) => r._id),
    ).toEqual([dates._id, untitled._id]);

    // The current node's branch is active; the tool call and output are gone and the two
    // replies around them merged; the image is a placeholder; models are the original slugs.
    const branch = (await s.view(dates._id))!.messages;
    expect(branch.map((m) => [m.role, m.text, m.model ?? null])).toEqual([
      ["user", "How do I parse dates?", null],
      ["assistant", "Use date-fns.", "gpt-4o"],
      ["user", "[image]\n\nWhat's in this picture?", null],
      ["assistant", "It's a cat.\n\nIt has whiskers.", "gpt-4o"],
    ]);
    expect(branch[0].siblingIds).toHaveLength(2); // the edited question is the other version
    expect(branch[1].siblingIds).toHaveLength(2); // the regenerated answer too
    await s.owner.mutation(api.chat.switchBranch, {
      messageId: branch[0].siblingIds[1],
    });
    expect((await s.view(dates._id))!.messages.map((m) => m.text)).toEqual([
      "How do I parse ISO dates?",
      "Use Date.parse.",
    ]);

    const attached = (await s.view(untitled._id))!.messages[0].text;
    expect(attached).toContain("[file: report.pdf]");
    const contents = (await s.all("messages")).map((m) => m.content).join("\n");
    expect(contents).not.toMatch(/tool output|print\(1\)|You are helpful/);
  });

  test("costs nothing: no usage, no rollups, no title job, thread totals at zero", async () => {
    const s = await setup();
    await s.upload(chatgptExport); // no fake provider: any model call would throw
    expect(
      (await s.all("messages")).every(
        (m) =>
          m.status === "done" &&
          m.usage === undefined &&
          m.costMicroUsd === undefined,
      ),
    ).toBe(true);
    expect(await s.all("dailyUsage")).toEqual([]);
    expect(await s.all("sideJobs")).toEqual([]);
    const [thread] = await s.all("threads");
    expect(
      (await s.owner.query(api.inspector.get, { threadId: thread._id }))!.thread
        .costMicroUsd,
    ).toBe(0);
  });

  test("importing the same file again skips what's already here", async () => {
    const s = await setup();
    await s.upload(chatgptExport);
    await s.upload(chatgptExport);
    const [again] = await s.owner.query(api.imports.list, {});
    expect(again).toMatchObject({ status: "done", imported: 0, skipped: 2 });
    expect(await s.all("threads")).toHaveLength(2);
  });

  test("a file that isn't an export fails with the stated error and is deleted", async () => {
    const s = await setup();
    const { storageId } = await s.upload({ hello: "world" }, "notes.json");
    const [job] = await s.owner.query(api.imports.list, {});
    expect(job).toMatchObject({
      status: "failed",
      error: "This isn't a ChatGPT or Claude conversations.json export",
    });
    expect(await s.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    await s.upload("{not json", "broken.json");
    expect((await s.owner.query(api.imports.list, {}))[0].status).toBe(
      "failed",
    );
  });

  test("a continuation picks up at the conversation it reached; long conversations go in chunks", async () => {
    const s = await setup();
    // 450 turns: more than one chunk of messages.
    const mapping: Record<string, unknown> = {
      root: { id: "root", children: ["m0"] },
    };
    for (let i = 0; i < 900; i++) {
      mapping[`m${i}`] = {
        id: `m${i}`,
        parent: i ? `m${i - 1}` : "root",
        children: i < 899 ? [`m${i + 1}`] : [],
        message: {
          author: { role: i % 2 ? "assistant" : "user" },
          content: { content_type: "text", parts: [`message ${i}`] },
          recipient: "all",
        },
      };
    }
    const long = {
      id: "long",
      title: "Long",
      create_time: 1,
      current_node: "m899",
      mapping,
    };
    const storageId = await s.t.run((ctx) =>
      ctx.storage.store(new Blob([JSON.stringify([chatgptExport[0], long])])),
    );
    const importId = await s.t.run((ctx) =>
      ctx.db.insert("imports", {
        ownerId: s.ownerId,
        fileName: "c.json",
        storageId,
        providerId: s.providerId,
        modelId: "claude-sonnet-5-5",
        status: "running",
        source: "chatgpt",
        total: 2,
        imported: 1,
        skipped: 0,
      }),
    );
    await s.t.action(internal.importActions.run, { importId, from: 1 });
    const threads = await s.all("threads");
    expect(threads.map((th) => th.title)).toEqual(["Long"]); // only from conversation 1 on
    const branch = (await s.view(threads[0]._id))!.messages;
    expect(branch).toHaveLength(900);
    expect(branch.at(-1)!.text).toBe("message 899");
    expect((await s.owner.query(api.imports.list, {}))[0]).toMatchObject({
      status: "done",
      imported: 2,
    });
  });

  test("condense now works before the first reply, and the inspector prices continuing", async () => {
    const s = await setup();
    await s.upload(chatgptExport);
    const thread = (await s.all("threads")).find(
      (th) => th.importedFrom?.externalId === "conv-b",
    )!;
    const inspector = (await s.owner.query(api.inspector.get, {
      threadId: thread._id,
    }))!;
    expect(inspector.next.prefixTokens).toBeGreaterThan(500);
    expect(inspector.next.prices).not.toBeNull();

    fake = fakeFetch({
      [ANTHROPIC]: {
        body: sse(
          messageStart({ input_tokens: 900, output_tokens: 0 }),
          textDelta("Imported summary"),
          messageDelta({ output_tokens: 20 }),
          messageStop,
        ),
      },
    });
    await s.owner.mutation(api.settings.setCondense, { keepTurns: 2 });
    await s.owner.mutation(api.condense.condenseNow, { threadId: thread._id });
    await s.t.finishAllScheduledFunctions(() => {});
    expect((await s.view(thread._id))!.checkpoint).toMatchObject({
      summary: "Imported summary",
      turns: 2,
    });
  });
});

describe("importing a Claude export", () => {
  test("is detected on its own; text joins, tools drop, attachments become placeholders", async () => {
    const s = await setup();
    await s.upload(claudeExport);
    const [job] = await s.owner.query(api.imports.list, {});
    expect(job).toMatchObject({ source: "claude", status: "done", total: 2, imported: 2 }); // the empty one is left out
    const threads = await s.all("threads");
    const lisbon = threads.find((th) => th.importedFrom?.externalId === "c-lin")!;
    expect(lisbon).toMatchObject({ title: "Lisbon weekend", startedAt: Date.parse("2024-03-01T10:00:00Z"), importedFrom: { source: "claude" } });
    expect((await s.view(lisbon._id))!.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Plan a weekend in Lisbon\n\n[file: notes.txt]"],
      ["assistant", "Let me check the weather.\n\nHere's a plan: Alfama, then Belem."],
      ["user", "Is this the tram?\n\n[image]"],
      ["assistant", "Yes, that's tram 28."],
    ]);
    expect((await s.all("messages")).every((m) => m.usage === undefined)).toBe(true);
    expect(await s.all("dailyUsage")).toEqual([]);
  });

  test("parent references build branches, with the latest message active", async () => {
    const s = await setup();
    await s.upload(claudeExport);
    const tree = (await s.all("threads")).find((th) => th.importedFrom?.externalId === "c-tree")!;
    expect(tree.title).toBe("What is a monad?"); // untitled: the first message's start
    const branch = (await s.view(tree._id))!.messages;
    expect(branch.map((m) => m.text)).toEqual(["What is a monad?", "A monad wraps values with bind.", "Example?", "Maybe and List."]);
    expect(branch[0].siblingIds).toHaveLength(2); // the functor question is another root
    expect(branch[1].siblingIds).toHaveLength(2); // the retried answer

    await s.upload(claudeExport);
    expect((await s.owner.query(api.imports.list, {}))[0]).toMatchObject({ imported: 0, skipped: 2 });
  });
});
