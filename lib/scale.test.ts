import { expect, test } from "vitest";
import { ctxScale, niceCeil } from "./scale";

test("niceCeil rounds up to 1, 2 or 5 times a power of ten", () => {
  expect(niceCeil(0)).toBe(1);
  expect(niceCeil(0.37)).toBe(0.5);
  expect(niceCeil(1)).toBe(1);
  expect(niceCeil(1.2)).toBe(2);
  expect(niceCeil(463_000)).toBe(500_000);
  expect(niceCeil(5_000_001)).toBe(10_000_000);
});

test("the context ruler rounds up with headroom and never below 1k", () => {
  expect(ctxScale(0)).toBe(1000);
  expect(ctxScale(900)).toBe(1000);
  expect(ctxScale(960)).toBe(2000);
  expect(ctxScale(18_200)).toBe(20_000);
  expect(ctxScale(19_500)).toBe(50_000);
  expect(ctxScale(180_000)).toBe(200_000);
  expect(ctxScale(1_000_000)).toBe(2_000_000);
});
