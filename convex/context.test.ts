/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { untagged } from "../test/untagged";
import { messageStop, sse, textDelta } from "../test/sse";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SUMMARY_PREFIX } from "./lib/context";
import { CURRENT_SYSTEM_PROMPT_VERSION, SYSTEM_PROMPTS } from "./lib/systemPrompts";
import { encryptSecret } from "./lib/vault";
import { ancestorIds } from "./lib/ancestors";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "160.79.104.10", family: 4 }] }));

beforeAll(setAuthEnv);
let fake: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => fake?.restore());

type Block = { type: "text"; text: string };
type Body = { system: Block[]; messages: { role: string; content: string | Block[] }[] };
const text = (content: string | Block[]) => untagged(typeof content === "string" ? content : content.map((b) => b.text).join(""));

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
  fake = fakeFetch({ "POST https://api.anthropic.com/v1/messages": { body: sse(textDelta("ok"), messageStop) } });

  // Seeds finished turns under `parent` (or the root); returns every message id, in order.
  const seed = (parent: Id<"messages"> | null, turns: { user: string; reply: string; pinned?: boolean }[]) =>
    t.run(async (ctx) => {
      const ids: Id<"messages">[] = [];
      let ancestors = parent ? [...(await ancestorIds(ctx, (await ctx.db.get("messages", parent))!)), parent] : [];
      for (const turn of turns) {
        for (const [role, content] of [["user", turn.user], ["assistant", turn.reply]] as const) {
          const id = await ctx.db.insert("messages", {
            ownerId, threadId, parentId: ancestors.at(-1), ancestorIds: ancestors, role, content, status: "done",
            pinned: role === "user" && turn.pinned === true,
          });
          ids.push(id);
          ancestors = [...ancestors, id];
        }
      }
      return ids;
    });
  const checkpoint = (coversUpToId: Id<"messages">, summary: string) =>
    t.run((ctx) => ctx.db.insert("checkpoints", { ownerId, threadId, coversUpToId, summary, tokens: 100 }));
  const sendFrom = async (leaf: Id<"messages">, content: string) => {
    await t.run((ctx) => ctx.db.patch("threads", threadId, { activeLeafId: leaf }));
    await owner.mutation(api.chat.send, { threadId, content });
    await t.finishAllScheduledFunctions(() => {});
    return fake!.requests.at(-1)!.body as Body;
  };
  return { t, owner, threadId, seed, checkpoint, sendFrom };
}

const turns = (from: number, to: number, opts: { pin?: number; tag?: string } = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    const tag = opts.tag ?? "";
    return { user: `U${n}${tag}`, reply: `A${n}${tag}`, pinned: n === opts.pin };
  });
const verbatim = (from: number, to: number, tag = "") => turns(from, to, { tag }).flatMap((x) => [x.user, x.reply]);
const contents = (body: Body) => body.messages.map((m) => text(m.content));

describe("context assembly", () => {
  test("with no checkpoint, the request is the system prompt and the whole branch", async () => {
    const s = await setup();
    const ids = await s.seed(null, turns(1, 3));
    const body = await s.sendFrom(ids.at(-1)!, "U4");
    expect(text(body.system)).toBe(SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION]);
    expect(contents(body)).toEqual([...verbatim(1, 3), "U4"]);
  });

  test("turn 40 of a thread condensed twice and forked twice", async () => {
    const s = await setup();
    // Main branch: turns 1-39, U15 pinned.
    const main = await s.seed(null, turns(1, 39, { pin: 15 }));
    const reply = (n: number) => main[n * 2 - 1]; // id of A<n>
    await s.checkpoint(reply(10), "S1: turns 1-10");
    await s.checkpoint(reply(30), "S2: turns 1-30"); // rolls S1 forward
    // A fork after both checkpoints (from A34) and one between them (from A20).
    const lateFork = await s.seed(reply(34), turns(35, 35, { tag: "late" }));
    const earlyFork = await s.seed(reply(20), turns(21, 21, { tag: "early" }));

    // Main, turn 40: only the latest checkpoint applies; the pin covered by it follows the summary.
    const turn40 = await s.sendFrom(main.at(-1)!, "U40");
    expect(contents(turn40)).toEqual([SUMMARY_PREFIX + "S2: turns 1-30", "U15", ...verbatim(31, 39), "U40"]);
    expect(turn40.messages[0].role).toBe("user");

    // A fork after both checkpoints sees the latest one.
    const late = await s.sendFrom(lateFork.at(-1)!, "U36late");
    expect(contents(late)).toEqual([SUMMARY_PREFIX + "S2: turns 1-30", "U15", ...verbatim(31, 34), "U35late", "A35late", "U36late"]);

    // A fork made before the second checkpoint never sees it, only the first; U15 is verbatim, in place.
    const early = await s.sendFrom(earlyFork.at(-1)!, "U22early");
    expect(contents(early)).toEqual([SUMMARY_PREFIX + "S1: turns 1-10", ...verbatim(11, 20), "U21early", "A21early", "U22early"]);

    // None of it touched the system prompt.
    for (const body of [turn40, late, early]) expect(text(body.system)).toBe(SYSTEM_PROMPTS[CURRENT_SYSTEM_PROMPT_VERSION]);
  });

  test("a pinned message inside the covered range keeps its original order with other pins", async () => {
    const s = await setup();
    const ids = await s.seed(null, [
      { user: "U1", reply: "A1", pinned: true },
      { user: "U2", reply: "A2" },
      { user: "U3", reply: "A3", pinned: true },
      { user: "U4", reply: "A4" },
    ]);
    await s.checkpoint(ids[5], "S: turns 1-3"); // covers through A3
    const body = await s.sendFrom(ids.at(-1)!, "U5");
    expect(contents(body)).toEqual([SUMMARY_PREFIX + "S: turns 1-3", "U1", "U3", "U4", "A4", "U5"]);
  });

  test("assembling the same branch twice gives byte-identical requests", async () => {
    const s = await setup();
    const ids = await s.seed(null, turns(1, 12, { pin: 3 }));
    await s.checkpoint(ids[9], "S: turns 1-5");
    await s.sendFrom(ids.at(-1)!, "U13");
    const first = fake!.requests.at(-1)!.body;

    const [, , reply] = (await s.owner.query(api.chat.getThread, { threadId: s.threadId }))!.messages.slice(-3);
    await s.owner.mutation(api.chat.retry, { messageId: reply._id });
    await s.t.finishAllScheduledFunctions(() => {});
    expect(JSON.stringify(fake!.requests.at(-1)!.body)).toBe(JSON.stringify(first));
  });
});
