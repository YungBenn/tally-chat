import { describe, expect, test } from "vitest";
import { splitBlocks } from "./markdownBlocks";

describe("splitBlocks", () => {
  test("cuts at top-level blocks and loses no text", () => {
    const text = "# Title\n\nA paragraph.\n\n- one\n- two\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nEnd.";
    const blocks = splitBlocks(text);
    expect(blocks.join("")).toBe(text);
    expect(blocks).toEqual([
      "# Title\n\n",
      "A paragraph.\n\n",
      "- one\n- two\n\n",
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n",
      "End.",
    ]);
  });

  test("keeps a display math block with a blank line whole", () => {
    expect(splitBlocks("Before.\n\n$$\na = b\n\nc = d\n$$\n\nAfter.")).toEqual([
      "Before.\n\n",
      "$$\na = b\n\nc = d\n$$\n\n",
      "After.",
    ]);
  });

  test("keeps a table and a loose list whole", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |\n\n";
    const list = "1. one\n\n2. two\n\n   more of two\n";
    expect(splitBlocks(table + list)).toEqual([table, list]);
  });

  test("a fence still streaming in runs to the end", () => {
    expect(splitBlocks("Intro.\n\n```py\nx = 1\n\ny = 2")).toEqual(["Intro.\n\n", "```py\nx = 1\n\ny = 2"]);
  });

  test("text with link or footnote definitions stays whole", () => {
    const link = "See [docs][1].\n\nMore.\n\n[1]: https://example.com";
    const note = "A claim.[^n]\n\nMore.\n\n[^n]: The source.";
    expect(splitBlocks(link)).toEqual([link]);
    expect(splitBlocks(note)).toEqual([note]);
  });

  test("leading blank lines stay with the first block", () => {
    expect(splitBlocks("\n\nOne.\n\nTwo.")).toEqual(["\n\nOne.\n\n", "Two."]);
    expect(splitBlocks("")).toEqual([""]);
  });
});
