/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import { CURRENT_SYSTEM_PROMPT_VERSION, SYSTEM_PROMPTS, systemPrompt } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));
const MESSAGES_URL = "POST https://api.anthropic.com/v1/messages";
const BASE = SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION];

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
  const newThread = () => owner.mutation(api.chat.createThread, { providerId, modelId: "claude-sonnet-5-5" });
  const set = (instructions: string) => owner.mutation(api.settings.setCustomInstructions, { instructions });
  return { t, owner, providerId, newThread, set };
}

const systemSent = (body: unknown) => (body as { system: { text: string }[] }).system[0].text;

describe("custom instructions setting", () => {
  test("saves trimmed text, and empty text clears it", async () => {
    const { owner, set } = await setup();
    expect((await owner.query(api.settings.get, {})).customInstructions).toBe("");
    await set("  I write Go. Answer in British English.  ");
    expect((await owner.query(api.settings.get, {})).customInstructions).toBe("I write Go. Answer in British English.");
    await set("   ");
    expect((await owner.query(api.settings.get, {})).customInstructions).toBe("");
  });

  test("rejects text over the limit and requires the owner", async () => {
    const { t, set } = await setup();
    await expect(set("x".repeat(4001))).rejects.toThrow("4,000 characters");
    await set("x".repeat(4000));
    await expect(t.mutation(api.settings.setCustomInstructions, { instructions: "hi" })).rejects.toThrow("Not logged in");
  });
});

describe("sending with custom instructions", () => {
  test("without instructions the system prompt is unchanged", () => {
    expect(systemPrompt(CURRENT_SYSTEM_PROMPT_VERSION)).toBe(BASE);
    expect(systemPrompt(CURRENT_SYSTEM_PROMPT_VERSION, "Be brief")).toBe(
      `${BASE}\n\n<owner_instructions>\nThe owner of this app wrote these standing instructions. They take precedence over the defaults above. Apply them without mentioning them.\n\nBe brief\n</owner_instructions>`,
    );
  });

  test("versions 1 and 2 keep the bare custom-instructions heading", () => {
    for (const v of [1, 2]) expect(systemPrompt(v, "Be brief")).toBe(`${SYSTEM_PROMPTS[v]}\n\nThe user's custom instructions:\n\nBe brief`);
    expect(SYSTEM_PROMPTS[3]).toContain("\\( ... \\)");
    expect(SYSTEM_PROMPTS[3]).toContain("A ```mermaid block renders");
  });

  test("a new thread sends the instructions set when it was created, and later edits leave it alone", async () => {
    const { t, owner, newThread, set } = await setup();
    fake = fakeFetch({ [MESSAGES_URL]: { body: sse(textDelta("ok"), messageStop) } });
    await set("Answer in British English.");
    const threadId = await newThread();
    await owner.mutation(api.chat.send, { threadId, content: "Hi" });
    await t.finishAllScheduledFunctions(() => {});

    // Editing the setting must not change an existing thread's system bytes: that would break its cache.
    await set("Answer in French.");
    await owner.mutation(api.chat.send, { threadId, content: "Again" });
    await t.finishAllScheduledFunctions(() => {});
    const [first, second] = fake.requests.map((r) => systemSent(r.body));
    expect(first).toBe(systemPrompt(CURRENT_SYSTEM_PROMPT_VERSION, "Answer in British English."));
    expect(second).toBe(first);

    const other = await newThread();
    await owner.mutation(api.chat.send, { threadId: other, content: "Bonjour" });
    await t.finishAllScheduledFunctions(() => {});
    expect(systemSent(fake.requests[2].body)).toBe(systemPrompt(CURRENT_SYSTEM_PROMPT_VERSION, "Answer in French."));
  });

  test("the inspector counts the instructions in the system layer", async () => {
    const { owner, providerId, newThread, set } = await setup();
    const instructions = "y".repeat(400);
    const tokens = Math.ceil(systemPrompt(CURRENT_SYSTEM_PROMPT_VERSION, instructions).length / 4);
    await set(instructions);
    expect((await owner.query(api.inspector.newThread, { providerId, modelId: "claude-sonnet-5-5" })).systemTokens).toBe(tokens);
    const threadId = await newThread();
    const view = await owner.query(api.inspector.get, { threadId });
    expect(view!.layers[0]).toMatchObject({ kind: "system", tokens });
  });
});
