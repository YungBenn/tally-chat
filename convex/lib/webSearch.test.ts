import { expect, test } from "vitest";
import { parseSearxng } from "./webSearch";

test("results without a host are skipped, and the next good ones fill their places", () => {
  const result = (url: string) => ({ title: url, url, content: "" });
  const results = parseSearxng({
    results: [
      result("https://bun.com/blog/bun-v1.4.4"),
      result("http:///go/v1/AS80J-lip9tLawFXAAHPEdrl"),
      result("/go/v1/relative"),
      result("https://x.com/bunjavascript"),
      ...["a", "b", "c", "d", "e"].map((n) => result(`https://${n}.example/`)),
    ],
  });
  expect(results.map((r) => r.url)).toEqual([
    "https://bun.com/blog/bun-v1.4.4",
    "https://x.com/bunjavascript",
    "https://a.example/",
    "https://b.example/",
    "https://c.example/",
    "https://d.example/",
  ]);
});
