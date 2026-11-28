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

const part = (label: string, value: unknown) => ({ label, value });
const split = (parts: unknown) => JSON.stringify({ parts });
const bars = (rows: unknown) => JSON.stringify({ rows });
const many = (n: number, make: (i: number) => object) => Array.from({ length: n }, (_, i) => make(i));

describe("parseVisualBlock split", () => {
  test("a valid block is returned typed; unknown keys are dropped", () => {
    expect(parseVisualBlock("split", JSON.stringify({ x: 1, parts: [{ ...part("A", 3), color: "red" }, part("B", 1)] }))).toEqual({
      kind: "split",
      parts: [part("A", 3), part("B", 1)],
    });
  });

  test("two to five parts are valid; one or six are not", () => {
    const n = (k: number) => split(many(k, (i) => part(`p${i}`, 1)));
    expect([1, 2, 5, 6].map((k) => parseVisualBlock("split", n(k)) !== null)).toEqual([false, true, true, false]);
  });

  test("zero values are fine while the sum is positive; a zero sum is not", () => {
    expect(parseVisualBlock("split", split([part("A", 0), part("B", 5)]))).not.toBeNull();
    expect(parseVisualBlock("split", split([part("A", 0), part("B", 0)]))).toBeNull();
    expect(parseVisualBlock("split", split([part("A", 1e308), part("B", 1e308)]))).toBeNull(); // sum overflows
  });

  test("a label is valid at 60 characters and invalid at 61", () => {
    expect(parseVisualBlock("split", split([part("x".repeat(60), 1), part("B", 1)]))).not.toBeNull();
    expect(parseVisualBlock("split", split([part("x".repeat(61), 1), part("B", 1)]))).toBeNull();
  });

  test.each([
    ["a negative value", split([part("A", -1), part("B", 5)])],
    ["a string value", split([part("A", "3"), part("B", 5)])],
    ["a null value", split([part("A", null), part("B", 5)])],
    ["a missing label", split([{ value: 1 }, part("B", 5)])],
    ["an empty label", split([part("", 1), part("B", 5)])],
    ["parts not an array", '{"parts":1}'],
    ["a null part", split([null, part("B", 1)])],
    ["invalid JSON", "{parts"],
  ])("%s is null", (_, source) => {
    expect(parseVisualBlock("split", source)).toBeNull();
  });
});

describe("parseVisualBlock bars", () => {
  test("a valid block is returned typed, with an optional display", () => {
    expect(parseVisualBlock("bars", bars([{ ...part("A", 42), display: "42%" }, part("B", 0)]))).toEqual({
      kind: "bars",
      rows: [{ label: "A", value: 42, display: "42%" }, { label: "B", value: 0 }],
    });
  });

  test("one to twelve rows are valid; zero or thirteen are not", () => {
    const n = (k: number) => bars(many(k, (i) => part(`r${i}`, i)));
    expect([0, 1, 12, 13].map((k) => parseVisualBlock("bars", n(k)) !== null)).toEqual([false, true, true, false]);
  });

  test("display is valid at 16 characters and invalid at 17", () => {
    expect(parseVisualBlock("bars", bars([{ ...part("A", 1), display: "x".repeat(16) }]))).not.toBeNull();
    expect(parseVisualBlock("bars", bars([{ ...part("A", 1), display: "x".repeat(17) }]))).toBeNull();
  });

  test("all-zero values are allowed", () => {
    expect(parseVisualBlock("bars", bars([part("A", 0), part("B", 0)]))).not.toBeNull();
  });

  test.each([
    ["a negative value", bars([part("A", -1)])],
    ["a non-finite value", '{"rows":[{"label":"A","value":1e999}]}'],
    ["a string value", bars([part("A", "1")])],
    ["an empty display", bars([{ ...part("A", 1), display: "" }])],
    ["a non-string display", bars([{ ...part("A", 1), display: 4 }])],
    ["a missing label", bars([{ value: 1 }])],
    ["rows not an array", '{"rows":{}}'],
  ])("%s is null", (_, source) => {
    expect(parseVisualBlock("bars", source)).toBeNull();
  });
});

describe("isOpenVisualFence", () => {
  test.each([
    ['```split\n{"parts":[', true],
    ['```bars\n{"rows":[]}\n```', false],
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
    ['[ref]: http://x\n\n```split\n{"parts":[', true],
    ['[ref]: http://x\n\n```split\n{}\n```\n\ntail', false],
    ['Intro\n\n```stats\n{}\n```\n\n```bars\n{"rows":[', true],
    ["```python\n```stats\n", false],
  ])("%j -> %s", (text, open) => {
    expect(isOpenVisualFence(text)).toBe(open);
  });
});
