import { expect, test } from "vitest";
import { looksSimple, worthSuggesting } from "./modelSuggestion";

test("short plain messages look simple; long, multi-line, code and image ones don't", () => {
  expect(looksSimple("What's the capital of Peru?", 0)).toBe(true);
  expect(looksSimple("Two lines\nare fine", 0)).toBe(true);
  expect(looksSimple("   ", 0)).toBe(false);
  expect(looksSimple("x".repeat(301), 0)).toBe(false);
  expect(looksSimple("one\ntwo\nthree", 0)).toBe(false);
  expect(looksSimple("Fix ```ts\nx\n```", 0)).toBe(false);
  expect(looksSimple("What is this?", 1)).toBe(false);
});

test("suggests only when the price gap is large", () => {
  const opus = { input: 4e-6, output: 2e-5 };
  const haiku = { input: 1e-7, output: 5e-7 };
  const sonnet = { input: 3e-6, output: 1.5e-5 };
  expect(worthSuggesting(opus, haiku)).toBe(true);
  expect(worthSuggesting(opus, sonnet)).toBe(false); // under 4x
  expect(worthSuggesting(haiku, haiku)).toBe(false);
  expect(worthSuggesting(null, haiku)).toBe(false); // unpriced
  expect(worthSuggesting({ input: 0, output: 0 }, { input: 0, output: 0 })).toBe(false); // free
});
