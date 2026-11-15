/// <reference types="vite/client" />
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/test";
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import {
  messageDelta,
  messageStart,
  messageStop,
  oaiDelta,
  oaiDone,
  oaiFinish,
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
const MODELS = "GET https://api.anthropic.com/v1/models?limit=1000";
const CACHING = {
  input_tokens: 5,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 2000,
  output_tokens: 1,
};
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]); // a few bytes are enough for the fake
const PNG_BASE64 = btoa(String.fromCharCode(...PNG));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Body = {
  max_tokens: number;
  stream: boolean;
  messages: { role: string; content: unknown }[];
};

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
        {
          id: "claude-sonnet-5-5",
          displayName: "Sonnet",
          hidden: false,
          vision: true,
        },
        {
          id: "claude-text-only",
          displayName: "Text",
          hidden: false,
          vision: false,
        },
      ],
    }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const threadId = await owner.mutation(api.chat.createThread, {
    providerId,
    modelId: "claude-sonnet-5-5",
  });
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
            textDelta("A cat"),
            messageDelta({ output_tokens: 1 }),
            messageStop,
          ),
        );
      },
    },
    [MODELS]: {
      body: {
        data: [
          {
            id: "claude-sonnet-5-5",
            display_name: "Claude Sonnet 5.5",
            capabilities: { image_input: { supported: true } },
          },
          {
            id: "claude-new",
            display_name: "Claude New",
            capabilities: { image_input: { supported: false } },
          },
        ],
      },
    },
  });
  const store = (bytes: Uint8Array<ArrayBuffer>, type = "image/png") =>
    t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));
  const image = (storageId: Id<"_storage">) => ({
    storageId,
    mediaType: "image/png" as const,
    width: 800,
    height: 600,
  });
  const replies = () =>
    fake!.requests
      .filter(
        (r) =>
          r.url.endsWith("/v1/messages") && (r.body as Body).max_tokens !== 30,
      )
      .map((r) => r.body as Body);
  return { t, owner, ownerId, providerId, threadId, store, image, replies };
}

const imageBlock = {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: PNG_BASE64 },
};

describe("images in Anthropic threads", () => {
  test("images go as base64 blocks before the text; the thread shows them; retries and keepalives send the same bytes", async () => {
    const s = await setup();
    const storageId = await s.store(PNG);
    await s.owner.mutation(api.chat.markActive, { threadId: s.threadId });
    await s.owner.mutation(api.chat.send, {
      threadId: s.threadId,
      content: "What is this?",
      images: [s.image(storageId)],
    });
    await s.t.finishAllScheduledFunctions(() => {});
    const [first] = s.replies();
    expect(first.messages[0]).toEqual({
      role: "user",
      content: [imageBlock, { type: "text", text: "What is this?" }],
    });

    const [user, reply] = (await s.owner.query(api.chat.getThread, {
      threadId: s.threadId,
    }))!.messages;
    expect(user.images).toEqual([
      { url: expect.any(String), width: 800, height: 600 },
    ]);

    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(JSON.stringify(s.replies()[1].messages)).toBe(
      JSON.stringify(first.messages),
    );

    await s.t.action(internal.chatActions.keepalive, { threadId: s.threadId });
    const keepalive = fake!.requests.find(
      (r) => (r.body as Body).stream === false,
    )!.body as Body;
    expect(keepalive.messages[0]).toEqual(first.messages[0]);
  });

  test("an edit keeps the original's images", async () => {
    const s = await setup();
    const storageId = await s.store(PNG);
    await s.owner.mutation(api.chat.send, {
      threadId: s.threadId,
      content: "What is this?",
      images: [s.image(storageId)],
    });
    await s.t.finishAllScheduledFunctions(() => {});
    const [user] = (await s.owner.query(api.chat.getThread, {
      threadId: s.threadId,
    }))!.messages;
    await s.owner.mutation(api.chat.edit, {
      messageId: user._id,
      content: "Describe it",
    });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(s.replies().at(-1)!.messages[0]).toEqual({
      role: "user",
      content: [imageBlock, { type: "text", text: "Describe it" }],
    });
  });

  test("refused for models without image support, non-image uploads and too many images", async () => {
    const s = await setup();
    const storageId = await s.store(PNG);
    const textOnly = await s.owner.mutation(api.chat.createThread, {
      providerId: s.providerId,
      modelId: "claude-text-only",
    });
    await expect(
      s.owner.mutation(api.chat.send, {
        threadId: textOnly,
        content: "Hi",
        images: [s.image(storageId)],
      }),
    ).rejects.toThrow("doesn't accept images");
    const notImage = await s.store(new Uint8Array([1, 2, 3]), "text/plain");
    await expect(
      s.owner.mutation(api.chat.send, {
        threadId: s.threadId,
        content: "Hi",
        images: [s.image(notImage)],
      }),
    ).rejects.toThrow("isn't an image");
    await expect(
      s.owner.mutation(api.chat.send, {
        threadId: s.threadId,
        content: "Hi",
        images: Array(9).fill(s.image(storageId)),
      }),
    ).rejects.toThrow("At most 8 images");
  });

  test("deleting the thread deletes its images", async () => {
    const s = await setup();
    const storageId = await s.store(PNG);
    await s.owner.mutation(api.chat.send, {
      threadId: s.threadId,
      content: "What is this?",
      images: [s.image(storageId)],
    });
    await s.t.finishAllScheduledFunctions(() => {});
    await s.owner.mutation(api.chat.deleteThread, { threadId: s.threadId });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(await s.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  test("refreshing the model list records image support and keeps the owner's names and hidden flags", async () => {
    const s = await setup();
    await s.owner.mutation(api.providers.updateModel, {
      providerId: s.providerId,
      modelId: "claude-sonnet-5-5",
      hidden: true,
    });
    await s.owner.action(api.providerActions.refreshModels, {
      providerId: s.providerId,
    });
    const [provider] = await s.owner.query(api.providers.list, {});
    expect(provider.models).toEqual([
      {
        id: "claude-sonnet-5-5",
        displayName: "Sonnet",
        hidden: true,
        vision: true,
      },
      {
        id: "claude-new",
        displayName: "Claude New",
        hidden: false,
        vision: false,
      },
    ]);
  });
});

describe("images on OpenAI-compatible providers", () => {
  async function openai() {
    const s = await setup();
    const apiKeyEncrypted = await s.t.run(() => encryptSecret("sk"));
    const providerId = await s.t.run((ctx) =>
      ctx.db.insert("providers", {
        ownerId: s.ownerId, name: "OpenAI", apiStyle: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKeyEncrypted,
        detected: "", keyCheckedAt: 0, models: [{ id: "gpt-5", displayName: "GPT-5", hidden: false }],
      }),
    );
    fake!.restore();
    fake = fakeFetch({
      "POST https://api.openai.com/v1/chat/completions": { body: oaiDelta("A cat") + oaiFinish({ prompt_tokens: 5, completion_tokens: 2 }) + oaiDone },
      "GET https://api.openai.com/v1/models": { body: { data: [{ id: "gpt-5" }] } },
    });
    const threadId = await s.owner.mutation(api.chat.createThread, { providerId, modelId: "gpt-5" });
    return { ...s, providerId, threadId };
  }

  test("marked models send images as image parts before the text", async () => {
    const s = await openai();
    await s.owner.mutation(api.providers.updateModel, { providerId: s.providerId, modelId: "gpt-5", vision: true });
    const storageId = await s.store(PNG);
    await s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "What is this?", images: [s.image(storageId)] });
    await s.t.finishAllScheduledFunctions(() => {});
    const body = fake!.requests.find((r) => r.url.endsWith("/chat/completions"))!.body as { messages: { role: string; content: unknown }[] };
    const user = body.messages.find((m) => m.role === "user")!;
    expect(user.content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
      { type: "text", text: "What is this?" },
    ]);
  });

  test("unmarked models refuse images; refreshing the list keeps the owner's toggle", async () => {
    const s = await openai();
    const storageId = await s.store(PNG);
    await expect(
      s.owner.mutation(api.chat.send, { threadId: s.threadId, content: "Hi", images: [s.image(storageId)] }),
    ).rejects.toThrow("doesn't accept images");
    await s.owner.mutation(api.providers.updateModel, { providerId: s.providerId, modelId: "gpt-5", vision: true });
    await s.owner.action(api.providerActions.refreshModels, { providerId: s.providerId });
    const provider = (await s.owner.query(api.providers.list, {})).find((p) => p._id === s.providerId)!;
    expect(provider.models[0]).toMatchObject({ id: "gpt-5", vision: true });
  });
});
