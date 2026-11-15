import { expect, test } from "vitest";
import { snippet } from "./search";

test("snippets center on the first matching term, with ellipses where cut", () => {
  const long = `${"intro words ".repeat(20)}here is that regex for parsing dates in logs ${"tail words ".repeat(20)}`;
  const s = snippet(long, "REGEX dates");
  expect(s.startsWith("…")).toBe(true);
  expect(s.endsWith("…")).toBe(true);
  expect(s).toContain("that regex for parsing dates");
  expect(s.length).toBeLessThan(200);
  expect(snippet("Short\n\nanswer", "answer")).toBe("Short answer");
  expect(snippet("no match here", "zebra")).toBe("no match here");
});
