/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
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
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "160.79.104.10", family: 4 }],
}));
const ANTHROPIC = "POST https://api.anthropic.com/v1/messages";

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  fake?.restore();
  vi.useRealTimers();
});

// Sonnet 5.5 per MTok: input $2, output $10, read $0.10, 5m write $2.50.
const REPLY = {
  input_tokens: 100,
  cache_read_input_tokens: 1000,
  cache_creation_input_tokens: 200,
  output_tokens: 5,
};
const REPLY_COST = Math.round(100 * 2 + 1000 * 0.1 + 200 * 2.5 + 5 * 10); // 850
const TITLE_COST = Math.round(20 * 2 + 3 * 10); // 70
const DAY = 86_400_000;

async function setup(
  budgetMicroUsd: number | null,
  model = "claude-sonnet-5-5",
) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-11-14T20:00:00Z")); // 03:00 on Nov 15 in Jakarta
  const t = convexTest(schema, modules);
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
        { id: "local-mystery", displayName: "Mystery", hidden: false },
      ],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  await owner.mutation(api.settings.setTimeZone, { timeZone: "Asia/Jakarta" });
  await owner.mutation(api.settings.setSideJobModel, {
    sideJobModel: { providerId, modelId: model },
  });
  await owner.mutation(api.settings.setDailyBudget, {
    microUsd: budgetMicroUsd,
  });
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const title =
          (JSON.parse(String(init?.body)) as { max_tokens: number })
            .max_tokens === 512;
        const usage = title
          ? { input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 3 }
          : REPLY;
        return new Response(
          sse(
            messageStart(usage),
            textDelta("ok"),
            messageDelta({}),
            messageStop,
          ),
        );
      },
    },
  });
  const threadId = await owner.mutation(api.chat.createThread, {
    providerId,
    modelId: model,
  });
  const send = async (content: string) => {
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
  };
  const messages = async () =>
    (await owner.query(api.chat.getThread, { threadId }))!.messages;
  const titleCalls = () =>
    fake!.requests.filter(
      (r) => (r.body as { max_tokens: number }).max_tokens === 512,
    ).length;
  return { t, owner, providerId, threadId, send, messages, titleCalls };
}

describe("the soft daily budget", () => {
  test("at 100% send, retry and edit are refused; an override lets them through for the rest of the day", async () => {
    const s = await setup(900);
    await s.send("One"); // spends 850 + 70 = 920
    expect(
      await s.owner.query(api.usage.budget, { today: "2026-11-15" }),
    ).toEqual({ budgetMicroUsd: 900, spentMicroUsd: REPLY_COST + TITLE_COST, overridden: false });

    await expect(
      s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Two" }),
    ).rejects.toThrow("Daily budget reached");
    const [user, reply] = await s.messages();
    await expect(
      s.owner.mutation(api.chat.retry, { messageId: reply._id }),
    ).rejects.toThrow("Daily budget reached");
    await expect(
      s.owner.mutation(api.chat.edit, { messageId: user._id, content: "Uno" }),
    ).rejects.toThrow("Daily budget reached");
    expect(await s.messages()).toHaveLength(2); // nothing was appended
    const threads = () => s.t.run(async (ctx) => (await ctx.db.query("threads").collect()).length);
    await expect(
      s.owner.mutation(api.chat.startThread, { providerId: s.providerId, modelId: "claude-sonnet-5-5", content: "New" }),
    ).rejects.toThrow("Daily budget reached");
    expect(await threads()).toBe(1); // no empty thread left behind

    await s.owner.mutation(api.settings.overrideBudgetToday, {});
    expect(
      (await s.owner.query(api.usage.budget, { today: "2026-11-15" }))
        .overridden,
    ).toBe(true);
    await s.send("Two");
    expect((await s.messages()).at(-1)).toMatchObject({ status: "done" });
  });

  test("the override and the spend reset at midnight in the owner's time zone", async () => {
    const s = await setup(800); // one reply (850) is over it
    await s.send("One");
    await s.owner.mutation(api.settings.overrideBudgetToday, {});
    await s.send("Two");
    vi.setSystemTime(Date.now() + DAY); // Nov 16 in Jakarta
    await s.send("Three"); // a new day starts at $0
    await expect(
      s.owner.mutation(api.chat.send, {
        threadId: s.threadId,
        content: "Four",
      }),
    ).rejects.toThrow("Daily budget reached");
  });

  test("keepalives and title side jobs pause while over budget and not overridden", async () => {
    const s = await setup(900);
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("One");
    expect(s.titleCalls()).toBe(1); // under budget when the title ran
    expect(
      await s.t.query(internal.keepalive.input, {
        threadId: s.threadId,
        now: Date.now(),
      }),
    ).toBeNull();
    const [, reply] = await s.messages();
    expect(
      await s.t.query(internal.chat.titleJobInput, {
        threadId: s.threadId,
        replyId: reply._id,
        now: Date.now(),
      }),
    ).toBeNull();

    await s.owner.mutation(api.settings.overrideBudgetToday, {});
    expect(
      await s.t.query(internal.keepalive.input, {
        threadId: s.threadId,
        now: Date.now(),
      }),
    ).not.toBeNull();
  });

  test("no budget means no limit; unpriced calls add $0; a budget must be above $0", async () => {
    const free = await setup(null);
    for (const c of ["One", "Two", "Three"]) await free.send(c);
    expect((await free.messages()).at(-1)).toMatchObject({ status: "done" });

    const mystery = await setup(1, "local-mystery");
    await mystery.send("One");
    await mystery.send("Two"); // no price, so nothing counts toward the budget
    expect(
      await mystery.owner.query(api.usage.budget, { today: "2026-11-15" }),
    ).toMatchObject({ spentMicroUsd: 0 });
    await expect(
      mystery.owner.mutation(api.settings.setDailyBudget, { microUsd: 0 }),
    ).rejects.toThrow("above $0");
  });
});
