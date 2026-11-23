import { expect, test } from "vitest";
import { parseExa } from "./webSearch";

test("results without a host are skipped, and the next good ones fill their places", () => {
  const result = (url: string) => ({ title: url, url, highlights: [] });
  const results = parseExa({
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

test("highlights are trimmed and joined, and a long snippet is cut at 300 characters", () => {
  const [joined, long] = parseExa({
    results: [
      { title: " Convex ", url: "https://www.convex.dev/", highlights: ["  Convex is a backend. ", "\nIt syncs.  "] },
      { title: "Docs", url: "https://docs.convex.dev/", highlights: ["x".repeat(400)] },
    ],
  });
  expect(joined).toEqual({ title: "Convex", url: "https://www.convex.dev/", snippet: "Convex is a backend. … It syncs." });
  expect(long.snippet).toBe(`${"x".repeat(299)}…`);
});

test("a missing or empty title falls back to the URL, and no highlights is an empty snippet", () => {
  const results = parseExa({
    results: [
      { title: null, url: "https://a.example/" },
      { title: "  ", url: "https://b.example/", highlights: [] },
    ],
  });
  expect(results).toEqual([
    { title: "https://a.example/", url: "https://a.example/", snippet: "" },
    { title: "https://b.example/", url: "https://b.example/", snippet: "" },
  ]);
});
