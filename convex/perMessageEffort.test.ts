/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { tagged } from "../test/untagged";
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
const BETA = "mid-conversation-output-config-2026-07-01";
const CACHING = {
  input_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 2000,
  output_tokens: 1,
};

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = {
  max_tokens: number;
  stream: boolean;
  output_config?: unknown;
  messages: { role: string; content: unknown; output_config?: unknown }[];
};

async function setup(model = "claude-sonnet-5-5") {
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
      models: [{ id: model, displayName: model, hidden: false }],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, {
    providerId,
    modelId: model,
  });
  let n = 0;
  fake = fakeFetch({
    [ANTHROPIC]: {
      respond: (init) => {
        const body = JSON.parse(String(init?.body)) as Body;
        if (!body.stream)
          return Response.json({
            type: "message",
            content: [],
            usage: {
              input_tokens: 2,
              cache_read_input_tokens: 2000,
              output_tokens: 0,
            },
          });
        return new Response(
          sse(
            messageStart(CACHING),
            textDelta(`R${++n}`),
            messageDelta({ output_tokens: 1 }),
            messageStop,
          ),
        );
      },
    },
  });
  const send = async (content: string, effort?: "low" | "high") => {
    await owner.mutation(api.chat.send, { threadId, content, effort });
    await t.finishAllScheduledFunctions(() => {});
  };
  // Reply requests with their headers, title side jobs (30 tokens) left out.
  const replies = () =>
    fake!.requests
      .filter(
        (r) => (r.body as Body).max_tokens !== 30 && (r.body as Body).stream,
      )
      .map((r) => ({
        body: r.body as Body,
        beta: r.headers["anthropic-beta"],
      }));
  const messages = async () =>
    (await owner.query(api.chat.getThread, { threadId }))!.messages;
  return { t, owner, threadId, send, replies, messages };
}

const effortMessage = (effort: string) => ({
  role: "system",
  content: [],
  output_config: { effort },
});

describe("per-message effort", () => {
  test("a change is sent right after its user message with the beta header, and governs replies from then on", async () => {
    const s = await setup();
    await s.send("One");
    await s.send("Hard question", "high");
    await s.send("Follow-up");
    const [first, second, third] = s.replies();

    expect(first.beta).toBeUndefined();
    expect(second.beta).toBe(BETA);
    expect(second.body.output_config).toEqual({ effort: "low" }); // the thread's level stays put
    expect(second.body.messages.slice(2)).toEqual([
      { role: "user", content: "Hard question" },
      effortMessage("high"),
    ]);

    // Later turns repeat it in the same place, byte for byte.
    expect(third.beta).toBe(BETA);
    expect(
      JSON.stringify(third.body.messages).startsWith(
        JSON.stringify(second.body.messages).slice(0, -1),
      ),
    ).toBe(true);

    expect(
      (await s.messages())
        .filter((m) => m.role === "assistant")
        .map((m) => m.effort),
    ).toEqual(["low", "high", "high"]);
    expect(
      (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!,
    ).toMatchObject({ effort: "high", perMessageEffort: true });
  });

  test("keepalives repeat the change identically", async () => {
    const s = await setup();
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.send("Hard question", "high");
    await s.t.action(internal.chatActions.keepalive, { threadId: s.threadId });
    const keepalive = fake!.requests.find(
      (r) => (r.body as Body).stream === false,
    )!;
    expect(keepalive.headers["anthropic-beta"]).toBe(BETA);
    expect((keepalive.body as Body).messages.slice(0, 2)).toEqual([
      { role: "user", content: tagged("Hard question") },
      effortMessage("high"),
    ]);
  });

  test("a fork above the change doesn't carry it; editing the changed message keeps it", async () => {
    const s = await setup();
    await s.send("One");
    await s.send("Hard question", "high");
    const [first, , hard] = await s.messages();
    await s.owner.mutation(api.chat.edit, {
      messageId: first._id,
      content: "Uno",
    });
    await s.t.finishAllScheduledFunctions(() => {});
    const fork = s.replies().at(-1)!;
    expect(fork.beta).toBeUndefined();
    expect(fork.body.messages).toEqual([{ role: "user", content: tagged("Uno") }]);

    await s.owner.mutation(api.chat.switchBranch, { messageId: hard._id });
    await s.owner.mutation(api.chat.edit, {
      messageId: hard._id,
      content: "Harder question",
    });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.replies().at(-1)!.body.messages.slice(2)).toEqual([
      { role: "user", content: "Harder question" },
      effortMessage("high"),
    ]);
  });

  test("models without per-message effort refuse it and change the thread's level instead", async () => {
    const s = await setup("claude-opus-4-8");
    await expect(
      s.owner.mutation(api.chat.send, {
        threadId: s.threadId,
        content: "Hi",
        effort: "high",
      }),
    ).rejects.toThrow("can't change effort per message");
    expect(
      (await s.owner.query(api.inspector.get, { threadId: s.threadId }))!
        .perMessageEffort,
    ).toBe(false);
    await s.owner.mutation(api.chat.setThreadEffort, {
      threadId: s.threadId,
      effort: "high",
    });
    await s.send("Hi");
    expect(s.replies().at(-1)!.body.output_config).toEqual({ effort: "high" });
  });

  test("proxy-prefixed model ids are recognized", async () => {
    const s = await setup("cc/claude-sonnet-5-5");
    await s.send("Hard question", "high");
    expect(s.replies()[0].beta).toBe(BETA);
  });
});
