import { describe, expect, test } from "vitest";
import {
  exportFileName,
  toJson,
  toMarkdown,
  type ExportThread,
} from "./exportThread";

const usage = {
  inputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens5m: 0,
  cacheWriteTokens1h: 0,
  outputTokens: 40,
  reasoningTokens: 0,
};
const thread: ExportThread = {
  title: "Parsing dates",
  messages: [
    {
      role: "user",
      status: "done",
      text: "How do I parse a date?",
      images: [{ url: null, width: 1, height: 1 }],
    },
    {
      role: "assistant",
      status: "done",
      text: "Use `Date.parse`.",
      model: "claude-sonnet-5-5",
      modelName: "Sonnet 5.5",
      effort: "low",
      usage,
      costMicroUsd: 4300,
    },
    { role: "user", status: "done", text: "And time zones?" },
    {
      role: "assistant",
      status: "stopped",
      text: "It depends",
      model: "claude-sonnet-5-5",
    },
    { role: "assistant", status: "error", text: "", error: "Rate limited" },
  ],
};
const at = new Date("2026-11-16T10:00:00Z");

describe("export", () => {
  test("Markdown: title, each turn, reply metadata, and nothing for failed replies", () => {
    expect(toMarkdown(thread, at)).toBe(
      [
        "# Parsing dates",
        "",
        "_Exported from tally.chat on 2026-11-16. Replies cost: $0.0043._",
        "",
        "## User",
        "",
        "How do I parse a date?",
        "",
        "_[1 image]_",
        "",
        "## Assistant",
        "",
        "_Sonnet 5.5 (low) · $0.0043 · 1k in (90% cached) · 40 out_",
        "",
        "Use `Date.parse`.",
        "",
        "## User",
        "",
        "And time zones?",
        "",
        "## Assistant",
        "",
        "_claude-sonnet-5-5 · stopped_",
        "",
        "It depends",
        "",
      ].join("\n"),
    );
  });

  test("JSON keeps raw usage and cost per message, and skips failed replies", () => {
    const data = JSON.parse(toJson(thread, at));
    expect(data).toMatchObject({
      format: "tally.chat/thread",
      version: 1,
      title: "Parsing dates",
      exportedAt: "2026-11-16T10:00:00.000Z",
      repliesCostMicroUsd: 4300,
    });
    expect(data.messages).toEqual([
      { role: "user", text: "How do I parse a date?", imageCount: 1 },
      {
        role: "assistant",
        text: "Use `Date.parse`.",
        model: "claude-sonnet-5-5",
        effort: "low",
        usage,
        costMicroUsd: 4300,
      },
      { role: "user", text: "And time zones?" },
      {
        role: "assistant",
        text: "It depends",
        model: "claude-sonnet-5-5",
        stopped: true,
      },
    ]);
  });

  test("file names are safe slugs of the title", () => {
    expect(exportFileName("Parsing dates: a / b?", "md")).toBe(
      "parsing-dates-a-b.md",
    );
    expect(exportFileName("???", "json")).toBe("thread.json");
  });
});

describe("export of a reply that called tools", () => {
  const withTools: ExportThread = {
    title: "Docs",
    messages: [
      { role: "user", status: "done", text: "Find the cache docs" },
      {
        role: "assistant",
        status: "done",
        text: "Let me look.\n\nFound it.",
        model: "claude-sonnet-5-5",
        items: [
          { kind: "text", text: "Let me look." },
          { kind: "tool", id: "t1", tool: "search", server: "Docs", status: "ok", input: '{\n  "q": "cache"\n}', result: "Result with ``` fence" },
          { kind: "text", text: "Found it." },
          { kind: "tool", id: "t2", tool: "delete", server: null, status: "declined", input: "{}", result: "The user declined this call." },
        ],
      },
    ],
  };

  test("Markdown shows each call and result as a fenced block under the reply, fenced safely", () => {
    const md = toMarkdown(withTools, at);
    expect(md).toContain(
      [
        "Let me look.",
        "",
        "Found it.",
        "",
        "**Tool call:** `search` (Docs) · ok",
        "",
        "```json",
        "{",
        '  "q": "cache"',
        "}",
        "```",
        "",
        "Result:",
        "",
        "````",
        "Result with ``` fence",
        "````",
        "",
        "**Tool call:** `delete` · declined",
      ].join("\n"),
    );
  });

  test("JSON carries the reply's parts, with arguments parsed", () => {
    const { messages } = JSON.parse(toJson(withTools, at)) as { messages: { parts?: unknown[] }[] };
    expect(messages[0].parts).toBeUndefined();
    expect(messages[1].parts).toEqual([
      { type: "text", text: "Let me look." },
      { type: "toolCall", id: "t1", tool: "search", server: "Docs", status: "ok", arguments: { q: "cache" }, result: "Result with ``` fence" },
      { type: "text", text: "Found it." },
      { type: "toolCall", id: "t2", tool: "delete", server: null, status: "declined", arguments: {}, result: "The user declined this call." },
    ]);
  });
});
