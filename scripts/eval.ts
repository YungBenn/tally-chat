/**
 * Answer-quality eval. A tool run by hand with Bun; not part of the app or the test suite.
 *
 *   bun scripts/eval.ts collect <export.zip|export-dir> [--out cases.jsonl] [--ordinary 20]
 *       Reads a Convex export (`npx convex export --path export.zip`) and writes one JSONL case per
 *       user message that was retried (sibling replies) or edited (sibling user messages), tagged
 *       retry-same-model, retry-other-model or edit, plus a random sample of ordinary single-reply
 *       turns. Each case has its branch history up to the user message and its original settings.
 *       Prune the file by hand before running. Images are not carried over.
 *
 *   bun scripts/eval.ts run <cases.jsonl> --a '<config>' --b '<config>' [--out results.jsonl] [--judge <model>]
 *       Replays every case under A and B, prints the estimated spend, and waits for "y".
 *       A config is JSON: {"promptVersion"?, "effort"?, "outputMode"?, "model"?}. Anything left out
 *       comes from the case's original settings. Then the judge compares each pair twice, order
 *       swapped; a win needs both orders to agree.
 *         --a '{"promptVersion":2}' --b '{"promptVersion":3}'
 *         --a '{"effort":"low"}' --b '{"effort":"medium","model":"claude-opus-5-5"}'
 *
 *   bun scripts/eval.ts report <results.jsonl>
 *       Win/tie/loss for B against A, mean output tokens and cost per side, disagreeing pairs.
 *
 * Environment (keys are read only from here, never from the app's stored provider keys):
 *   ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (default https://api.anthropic.com)   models named claude-*
 *   OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1)         every other model
 *   EVAL_JUDGE_MODEL   overrides the judge. Default: another family than the answers (OpenAI key for
 *                      Claude answers), else another Claude tier (opus judges non-opus, else sonnet).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Doc, Id } from "../convex/_generated/dataModel";
import type { QueryCtx } from "../convex/_generated/server";
import { assembleHistory } from "../convex/lib/context";
import { messagesBody, type ChatMessage } from "../convex/lib/anthropic";
import { outputCeiling, type OutputMode } from "../convex/lib/outputModes";
import type { Effort } from "../convex/lib/effort";
import { systemPrompt } from "../convex/lib/systemPrompts";
import {
  costMicroUsd,
  normalizeAnthropicUsage,
  normalizeOpenAIUsage,
  priceFor,
  type AnthropicUsage,
  type OpenAIUsage,
  type Usage,
} from "../convex/lib/usage";

type Kind = "retry-same-model" | "retry-other-model" | "edit" | "ordinary";
type Settings = {
  model: string;
  effort?: Effort;
  outputMode: OutputMode;
  systemPromptVersion: number;
  instructions?: string;
};
type Case = { id: string; kind: Kind; title: string; prompt: string; settings: Settings; history: ChatMessage[] };
type Config = { promptVersion?: number; effort?: Effort; outputMode?: OutputMode; model?: string };
type Answer = { text: string; usage: Usage; costMicroUsd: number | null; error?: string };
type Pick = "A" | "B" | "tie";
type Result = {
  id: string;
  kind: Kind;
  prompt: string;
  a: Answer;
  b: Answer;
  judge?: { model: string; first: Pick; second: Pick; costMicroUsd: number | null };
  verdict: Pick | "error";
};

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
const writeJsonl = (path: string, rows: unknown[]) => writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const usd = (micro: number | null) => (micro === null ? "unpriced" : `$${(micro / 1e6).toFixed(4)}`);

// ---------- collect ----------

type Row = Record<string, unknown> & { _id: string };

function loadExport(path: string): Record<string, Row[]> {
  const dir = statSync(path).isDirectory() ? path : (() => {
    const out = mkdtempSync(join(tmpdir(), "tally-export-"));
    execFileSync("unzip", ["-q", path, "-d", out]);
    return out;
  })();
  const tables: Record<string, Row[]> = {};
  for (const name of ["messages", "messageAncestors", "documents", "searches", "checkpoints"]) {
    const file = join(dir, name, "documents.jsonl");
    tables[name] = existsSync(file) ? readJsonl<Row>(file) : [];
  }
  tables.threads = readJsonl<Row>(join(dir, "threads", "documents.jsonl"));
  return tables;
}

// Just enough of a Convex read context for the app's own assembleHistory to run over exported rows.
function exportCtx(tables: Record<string, Row[]>): QueryCtx {
  const byId = new Map(Object.values(tables).flat().map((r) => [r._id, r]));
  return {
    db: {
      get: async (_table: string, id: string) => byId.get(id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) => {
          const eqs: [string, unknown][] = [];
          const q = { eq: (f: string, v: unknown) => (eqs.push([f, v]), q) };
          build(q);
          const rows = tables[table].filter((r) => eqs.every(([f, v]) => r[f] === v));
          return { take: async (n: number) => rows.slice(0, n), unique: async () => rows[0] ?? null };
        },
      }),
    },
  } as unknown as QueryCtx;
}

async function collect() {
  const input = process.argv[3];
  if (!input) throw new Error("usage: collect <export.zip|export-dir> [--out cases.jsonl] [--ordinary 20]");
  const tables = loadExport(input);
  const ctx = exportCtx(tables);
  const messages = tables.messages as unknown as Doc<"messages">[];
  const threads = new Map((tables.threads as unknown as Doc<"threads">[]).map((t) => [t._id, t]));
  const ancestors = new Map(tables.messageAncestors.map((r) => [r.messageId as string, r.ancestorIds as Id<"messages">[]]));
  const done = (m: Doc<"messages">) => m.role === "assistant" && m.status === "done" && m.content !== "";
  const childrenOf = new Map<string | undefined, Doc<"messages">[]>();
  for (const m of messages) childrenOf.set(m.parentId, [...(childrenOf.get(m.parentId) ?? []), m]);

  const picked: { user: Doc<"messages">; kind: Kind }[] = [];
  const ordinary: Doc<"messages">[] = [];
  const seenGroups = new Set<string>();
  for (const u of messages.filter((m) => m.role === "user")) {
    const group = (childrenOf.get(u.parentId) ?? []).filter((m) => m.role === "user");
    const replies = (childrenOf.get(u._id) ?? []).filter(done);
    if (group.length > 1 && u.parentId) {
      // An edited fork: one case per sibling group, from the latest edit.
      if (seenGroups.has(u.parentId)) continue;
      seenGroups.add(u.parentId);
      picked.push({ user: group.reduce((a, b) => (b._creationTime > a._creationTime ? b : a)), kind: "edit" });
    } else if (replies.length > 1)
      picked.push({ user: u, kind: new Set(replies.map((r) => r.model)).size > 1 ? "retry-other-model" : "retry-same-model" });
    else if (replies.length === 1) ordinary.push(u);
  }
  const want = Number(flag("ordinary") ?? 20);
  // Fisher-Yates over the ordinary turns, then take the first `want`.
  for (let i = ordinary.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ordinary[i], ordinary[j]] = [ordinary[j], ordinary[i]];
  }
  picked.push(...ordinary.slice(0, want).map((user) => ({ user, kind: "ordinary" as const })));

  const cases: Case[] = [];
  for (const { user, kind } of picked) {
    const thread = threads.get(user.threadId);
    if (!thread) continue;
    const branch = [...(ancestors.get(user._id) ?? user.ancestorIds ?? []), user._id];
    const { messages: history } = await assembleHistory(ctx, user.threadId, branch);
    const reply = (childrenOf.get(user._id) ?? []).find(done);
    cases.push({
      id: user._id,
      kind,
      title: thread.title,
      prompt: user.content.slice(0, 200),
      settings: {
        model: reply?.model ?? thread.modelId,
        effort: reply?.effort ?? thread.effort,
        outputMode: reply?.outputMode ?? "normal",
        systemPromptVersion: thread.systemPromptVersion,
        ...(thread.instructions ? { instructions: thread.instructions } : {}),
      },
      history: history.map((m) => ({ ...m, images: undefined })),
    });
  }
  const out = flag("out") ?? "cases.jsonl";
  writeJsonl(out, cases);
  const counts = Object.entries(Object.groupBy(cases, (c) => c.kind)).map(([k, v]) => `${k}: ${v?.length}`);
  console.log(`wrote ${cases.length} cases to ${out} (${counts.join(", ")})`);
}

// ---------- run ----------

const isClaude = (model: string) => model.split("/").at(-1)!.startsWith("claude-");
const tier = (model: string) => /opus|sonnet|haiku|fable/.exec(model)?.[0];

function setup(c: Case, cfg: Config) {
  const s = c.settings;
  return {
    model: cfg.model ?? s.model,
    // The app's own system prompt; the history was assembled by the app's own code at collect time.
    system: systemPrompt(cfg.promptVersion ?? s.systemPromptVersion, s.instructions),
    messages: c.history,
    effort: cfg.effort ?? s.effort,
    maxTokens: outputCeiling(cfg.outputMode ?? s.outputMode, cfg.effort ?? s.effort),
  };
}

async function complete(req: { model: string; system: string; messages: ChatMessage[]; effort?: Effort; maxTokens: number }): Promise<Answer> {
  const price = priceFor(req.model);
  try {
    if (isClaude(req.model)) {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      const body = messagesBody({ model: req.model, system: req.system, messages: req.messages, maxTokens: req.maxTokens, effort: req.effort }, false);
      const res = await fetch(`${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          // Per-message effort rides in system-role entries, which need the beta.
          ...(req.messages.some((m) => m.effort) ? { "anthropic-beta": "mid-conversation-output-config-2026-07-01" } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: AnthropicUsage; error?: { message?: string } };
      if (!res.ok) throw new Error(`${res.status} ${json.error?.message ?? ""}`);
      const { usage } = normalizeAnthropicUsage(json.usage ?? {});
      return { text: (json.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join(""), usage, costMicroUsd: costMicroUsd(usage, price) };
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    // ponytail: text turns only; tool-loop steps in a history are skipped for OpenAI-style models.
    const messages = [
      { role: "system", content: req.system },
      ...req.messages.filter((m) => !m.blocks && !m.toolResults).map((m) => ({ role: m.role, content: m.content })),
    ];
    const res = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: req.model, messages, max_completion_tokens: req.maxTokens }),
    });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: OpenAIUsage; error?: { message?: string } };
    if (!res.ok) throw new Error(`${res.status} ${json.error?.message ?? ""}`);
    const { usage, reportedCostMicroUsd } = normalizeOpenAIUsage(json.usage ?? {});
    return { text: json.choices?.[0]?.message?.content ?? "", usage, costMicroUsd: reportedCostMicroUsd ?? costMicroUsd(usage, price) };
  } catch (e) {
    return { text: "", usage: normalizeAnthropicUsage({}).usage, costMicroUsd: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const JUDGE_SYSTEM =
  "You compare two answers (1 and 2) to the same conversation. The owner who asked prefers concise, complete answers: " +
  "an answer wins by covering what the question needs with as little filler as possible. Do not reward length, " +
  "preamble, recaps or unrequested extras; do not reward an answer that leaves out something needed. " +
  "Reply with one line only: WINNER: 1, WINNER: 2 or WINNER: TIE.";

function judgeModel(models: string[]) {
  if (process.env.EVAL_JUDGE_MODEL) return process.env.EVAL_JUDGE_MODEL;
  if (models.some(isClaude) && process.env.OPENAI_API_KEY) return "gpt-5";
  if (!models.every(isClaude) && process.env.ANTHROPIC_API_KEY) return "claude-opus-5-5";
  return models.some((m) => tier(m) === "opus") ? "claude-sonnet-5-5" : "claude-opus-5-5";
}

async function judgeOnce(model: string, c: Case, first: Answer, second: Answer) {
  const context = c.history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n").slice(-8000);
  const user = `Conversation (the last turn is the one being answered):\n\n${context}\n\n--- Answer 1 ---\n${first.text}\n\n--- Answer 2 ---\n${second.text}`;
  const r = await complete({ model, system: JUDGE_SYSTEM, messages: [{ role: "user", content: user }], maxTokens: 50 });
  if (r.error) throw new Error(`judge: ${r.error}`);
  const m = /WINNER:\s*(1|2|TIE)/i.exec(r.text);
  return { pick: (m ? m[1].toUpperCase() : "TIE") as "1" | "2" | "TIE", cost: r.costMicroUsd };
}

async function run() {
  const file = process.argv[3];
  const [a, b] = ["a", "b"].map((k) => JSON.parse(flag(k) ?? "null") as Config | null);
  if (!file || !a || !b) throw new Error("usage: run <cases.jsonl> --a '<config>' --b '<config>' [--out results.jsonl] [--judge <model>]");
  const cases = readJsonl<Case>(file);
  const models = [...new Set(cases.flatMap((c) => [setup(c, a).model, setup(c, b).model]))];
  const judge = flag("judge") ?? judgeModel(models);

  // Rough spend: input is characters / 4, each answer ~1,000 tokens, the judge sees the history plus both answers twice.
  const estimate = (model: string, inTok: number, outTok: number) => {
    const p = priceFor(model);
    return p?.input === undefined || p.output === undefined ? null : Math.round((inTok * p.input + outTok * p.output) * 1e6);
  };
  const chars = (c: Case, cfg: Config) => setup(c, cfg).system.length + c.history.reduce((n, m) => n + m.content.length, 0);
  const parts = cases.flatMap((c) => [
    estimate(setup(c, a).model, chars(c, a) / 4, 1000),
    estimate(setup(c, b).model, chars(c, b) / 4, 1000),
    estimate(judge, (chars(c, a) / 4 + 2000) * 2, 100),
  ]);
  const total = parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  console.log(`${cases.length} cases, A=${JSON.stringify(a)} B=${JSON.stringify(b)} judge=${judge}`);
  console.log(`estimated spend: ${usd(total)}${parts.includes(null) ? " (some models have no price, so this is a floor)" : ""}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ok = (await rl.question("Call the providers? [y/N] ")).trim().toLowerCase() === "y";
  rl.close();
  if (!ok) return console.log("aborted, nothing was called");

  const results: Result[] = [];
  for (const c of cases) {
    const [ra, rb] = await Promise.all([complete(setup(c, a)), complete(setup(c, b))]);
    const base = { id: c.id, kind: c.kind, prompt: c.prompt, a: ra, b: rb };
    if (ra.error || rb.error) {
      results.push({ ...base, verdict: "error" });
      console.log(`${c.id}: error ${ra.error ?? rb.error}`);
      continue;
    }
    try {
      // Both orders; the answer a pick names is mapped back to A or B.
      const [x, y] = await Promise.all([judgeOnce(judge, c, ra, rb), judgeOnce(judge, c, rb, ra)]);
      const first: Pick = x.pick === "TIE" ? "tie" : x.pick === "1" ? "A" : "B";
      const second: Pick = y.pick === "TIE" ? "tie" : y.pick === "1" ? "B" : "A";
      const cost = x.cost === null || y.cost === null ? null : x.cost + y.cost;
      results.push({ ...base, judge: { model: judge, first, second, costMicroUsd: cost }, verdict: first === second ? first : "tie" });
    } catch (e) {
      results.push({ ...base, verdict: "error" });
      console.log(`${c.id}: ${e instanceof Error ? e.message : e}`);
    }
    console.log(`${c.id}: ${results.at(-1)!.verdict}`);
  }
  const out = flag("out") ?? "results.jsonl";
  writeJsonl(out, results);
  console.log(`wrote ${results.length} results to ${out}; run: bun scripts/eval.ts report ${out}`);
}

// ---------- report ----------

function report() {
  const file = process.argv[3];
  if (!file) throw new Error("usage: report <results.jsonl>");
  const all = readJsonl<Result>(file);
  const rows = all.filter((r) => r.verdict !== "error");
  const count = (v: Pick) => rows.filter((r) => r.verdict === v).length;
  console.log(`${rows.length} judged pairs (${all.length - rows.length} errored)`);
  console.log(`B wins ${count("B")}  ties ${count("tie")}  A wins (B losses) ${count("A")}`);
  for (const side of ["a", "b"] as const) {
    const answers = rows.map((r) => r[side]);
    const priced = answers.filter((x) => x.costMicroUsd !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    console.log(
      `${side.toUpperCase()}: mean output tokens ${mean(answers.map((x) => x.usage.outputTokens)).toFixed(0)}, ` +
        `mean cost ${priced.length ? usd(mean(priced.map((x) => x.costMicroUsd!))) : "unpriced"}`,
    );
  }
  const split = rows.filter((r) => r.judge && r.judge.first !== r.judge.second);
  console.log(`\nDisagreeing pairs (the two orders picked differently): ${split.length}`);
  for (const r of split)
    console.log(`  ${r.id} [${r.kind}] first order: ${r.judge!.first}, swapped order: ${r.judge!.second} - ${r.prompt.slice(0, 80).replace(/\s+/g, " ")}`);
}

const commands = { collect, run, report };
const cmd = commands[process.argv[2] as keyof typeof commands];
if (!cmd) throw new Error("usage: bun scripts/eval.ts <collect|run|report> ...");
await cmd();
