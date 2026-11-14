import { expect, test } from "vitest";
import { nextSendMicroUsd } from "./nextSend";

// Sonnet 5.5 per token: input $2/MTok, output $10, read $0.10, 5m write $2.50.
const prices = {
  input: 2e-6,
  output: 1e-5,
  cacheRead: 1e-7,
  cacheWrite: 2.5e-6,
};
const base = {
  prices,
  prefixTokens: 10_000,
  draftTokens: 100,
  expectedOutputTokens: 300,
};

test("prices the history by cache state, plus the draft and a typical reply", () => {
  expect(nextSendMicroUsd({ ...base, history: "warm" })).toBe(
    10_000 * 0.1 + 100 * 2 + 300 * 10,
  ); // 4,200
  expect(nextSendMicroUsd({ ...base, history: "cold" })).toBe(
    10_000 * 2.5 + 100 * 2 + 300 * 10,
  );
  expect(nextSendMicroUsd({ ...base, history: "provider" })).toBe(
    10_000 * 2 + 100 * 2 + 300 * 10,
  );
  expect(
    nextSendMicroUsd({ ...base, history: "warm", expectedOutputTokens: null }),
  ).toBe(1_200); // no replies yet
  expect(
    nextSendMicroUsd({ ...base, history: "warm", prices: null }),
  ).toBeNull();
  expect(
    nextSendMicroUsd({
      ...base,
      history: "cold",
      prices: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }),
  ).toBe(0);
});
