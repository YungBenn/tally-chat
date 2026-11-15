import { expect, test } from "vitest";
import { rollCells } from "./rolling";

test("digits become columns, other characters stay fixed", () => {
  expect(rollCells("0.0041")).toEqual([
    { key: "6", digit: 0 },
    { key: "5", char: "." },
    { key: "4", digit: 0 },
    { key: "3", digit: 0 },
    { key: "2", digit: 4 },
    { key: "1", digit: 1 },
  ]);
});

test("columns are keyed from the right, so decimals keep their place as the number grows", () => {
  const before = rollCells("9.99").map((c) => c.key);
  const after = rollCells("10.01").map((c) => c.key);
  expect(after.slice(-3)).toEqual(before.slice(-3));
});
