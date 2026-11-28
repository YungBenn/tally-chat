import { describe, expect, test } from "vitest";
import { isOpenVisualFence, parseVisualBlock } from "./visualBlocks";

const stats = (items: unknown) => JSON.stringify({ items });
const item = (over: object = {}) => ({ value: "27 of 32", label: "PRs merged", ...over });

describe("parseVisualBlock stats", () => {
  test("a valid block is returned typed, with an optional note", () => {
    expect(parseVisualBlock("stats", stats([item({ note: "84%" }), item({ value: "5" })]))).toEqual({
      kind: "stats",
      items: [
        { value: "27 of 32", label: "PRs merged", note: "84%" },
        { value: "5", label: "PRs merged" },
      ],
    });
  });

  test("unknown keys are ignored", () => {
    const block = parseVisualBlock("stats", JSON.stringify({ extra: 1, items: [{ ...item(), color: "red" }] }));
    expect(block).toEqual({ kind: "stats", items: [{ value: "27 of 32", label: "PRs merged" }] });
  });

  test("one to four items are valid; zero or five are not", () => {
    const n = (k: number) => stats(Array.from({ length: k }, () => item()));
    expect([0, 1, 4, 5].map((k) => parseVisualBlock("stats", n(k)) !== null)).toEqual([false, true, true, false]);
  });

  test.each([
    ["value", 16],
    ["label", 60],
    ["note", 30],
  ])("%s is valid at %i characters and invalid at one more", (key, max) => {
    expect(parseVisualBlock("stats", stats([item({ [key]: "x".repeat(max) })]))).not.toBeNull();
    expect(parseVisualBlock("stats", stats([item({ [key]: "x".repeat(max + 1) })]))).toBeNull();
  });

  test.each([
    ["invalid JSON", "{items: ["],
    ["not an object", "[1]"],
    ["items not an array", '{"items":"x"}'],
    ["a number value", stats([item({ value: 5 })])],
    ["a missing label", stats([{ value: "5" }])],
    ["an empty value", stats([item({ value: "" })])],
    ["a non-string note", stats([item({ note: 3 })])],
    ["a null item", stats([null])],
  ])("%s is null", (_, source) => {
    expect(parseVisualBlock("stats", source)).toBeNull();
  });

  test("an unknown kind is null", () => {
    expect(parseVisualBlock("chart", stats([item()]))).toBeNull();
  });
});

describe("isOpenVisualFence", () => {
  test.each([
    ["```stats", true],
    ["```stats\n", true],
    ['```stats\n{"items":[{"value":"1","label":"a"}]}', true],
    ['```stats\n{"items":[{"value":"1","label":"a"}]}\n``', true],
    ['```stats\n{"items":[{"value":"1","label":"a"}]}\n```', false],
    ['```stats\n{"items":[]}\n```\n', false],
    ['```stats\n{"items":[]}\n```  ', false],
    ["````stats\n{}\n```", true],
    ["````stats\n{}\n````", false],
    ["~~~stats\n{}\n~~~", false],
    ["```stats\n```", false],
    ["```python\nx = 1", false],
    ["Some prose", false],
  ])("%j -> %s", (text, open) => {
    expect(isOpenVisualFence(text)).toBe(open);
  });
});
