import { describe, expect, test } from "vitest";
import { cacheRing } from "./cacheRing";

describe("cacheRing", () => {
  test("cold has no ring and no time", () => {
    expect(cacheRing({ state: "cold" }, 0)).toEqual({ temp: "cold", remaining: 0, time: null });
  });
  test("warm drains over five minutes", () => {
    expect(cacheRing({ state: "warm", until: 300_000 }, 0)).toEqual({ temp: "warm", remaining: 1, time: "5:00" });
    expect(cacheRing({ state: "keepalive", until: 300_000 }, 48_000)).toMatchObject({ temp: "warm", time: "4:12" });
    expect(cacheRing({ state: "warm", until: 300_000 }, 150_000).remaining).toBe(0.5);
  });
  test("the last minute is cooling", () => {
    expect(cacheRing({ state: "warm", until: 300_000 }, 240_000)).toMatchObject({ temp: "cooling", time: "1:00" });
    expect(cacheRing({ state: "warm", until: 300_000 }, 252_000)).toMatchObject({ temp: "cooling", time: "0:48" });
  });
  test("a one-hour cache shows a full ring until its last five minutes", () => {
    expect(cacheRing({ state: "warm", until: 3_600_000 }, 0)).toMatchObject({ remaining: 1, time: "60:00" });
  });
});
