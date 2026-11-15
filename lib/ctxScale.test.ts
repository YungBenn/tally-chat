import { expect, test } from "vitest";
import { ctxScale } from "./ctxScale";

test("the ruler rounds up to 1, 2 or 5 times a power of ten with headroom", () => {
  expect(ctxScale(0)).toBe(1000);
  expect(ctxScale(900)).toBe(1000);
  expect(ctxScale(960)).toBe(2000);
  expect(ctxScale(18_200)).toBe(20_000);
  expect(ctxScale(19_500)).toBe(50_000);
  expect(ctxScale(180_000)).toBe(200_000);
  expect(ctxScale(1_000_000)).toBe(2_000_000);
});
