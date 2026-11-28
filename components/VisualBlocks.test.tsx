// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Markdown from "./Markdown";

const render = (text: string, streaming = false) => renderToStaticMarkup(<Markdown text={text} streaming={streaming} />);
const fence = (body: string, close = true) => "```stats\n" + body + (close ? "\n```" : "");
const two = JSON.stringify({
  items: [
    { value: "27 of 32", label: "PRs merged", note: "84%" },
    { value: "5", label: "PRs asked" },
  ],
});

describe("stats block", () => {
  test("renders values and labels as real text in a definition list", () => {
    const html = render(fence(two));
    expect(html).toContain("<dl");
    expect(html).toContain("27 of 32");
    expect(html).toContain("PRs merged");
    expect(html).toContain("84%");
    expect(html).not.toContain("tc-code");
    expect(html.match(/<dt/g)).toHaveLength(2);
    expect(html.match(/<dd/g)).toHaveLength(3); // two values and one note
  });

  test("the label precedes its value so a screen reader reads pairs in order", () => {
    const html = render(fence(two));
    expect(html.indexOf("PRs merged")).toBeLessThan(html.indexOf("27 of 32"));
  });

  test.each([
    ["invalid JSON", "{nope"],
    ["zero items", '{"items":[]}'],
    ["five items", JSON.stringify({ items: Array.from({ length: 5 }, () => ({ value: "1", label: "a" })) })],
    ["a long value", JSON.stringify({ items: [{ value: "x".repeat(17), label: "a" }] })],
  ])("%s is shown as a code block with the source", (_, body) => {
    const html = render(fence(body));
    expect(html).toContain("tc-code");
    expect(html).not.toContain("<dl");
  });

  test("an open fence while streaming is a placeholder, not partial JSON", () => {
    const html = render(fence('{"items":[{"value":"27', false), true);
    expect(html).toContain("tc-visual-ph");
    expect(html).not.toContain("27");
    expect(html).not.toContain("tc-code");
  });

  test("valid JSON before the fence closes is still a placeholder", () => {
    const html = render(fence(two, false), true);
    expect(html).toContain("tc-visual-ph");
    expect(html).not.toContain("<dl");
  });

  test("a partial closing fence is still a placeholder", () => {
    expect(render(fence(two).slice(0, -1), true)).toContain("tc-visual-ph");
  });

  test("the block renders when the fence closes, even while streaming", () => {
    const html = render(fence(two) + "\n\nBelow.", true);
    expect(html).toContain("<dl");
    expect(html).not.toContain("tc-visual-ph");
  });

  test("a finished reply left with an open fence shows the code, not a placeholder", () => {
    const html = render(fence(two, false), false);
    expect(html).toContain("tc-code");
    expect(html).not.toContain("tc-visual-ph");
  });

  test("an open fence of another language streams as code", () => {
    const html = render("```python\nx = 1", true);
    expect(html).toContain("tc-code");
    expect(html).not.toContain("tc-visual-ph");
  });
});

const fenceOf = (lang: string, body: unknown) => "```" + lang + "\n" + JSON.stringify(body) + "\n```";
const widths = (html: string) => [...html.matchAll(/--w:([\d.]+)%/g)].map((m) => Number(m[1]));

describe("split block", () => {
  const parts = [
    { label: "Opus", value: 60 },
    { label: "Sonnet", value: 30 },
    { label: "Haiku", value: 10 },
  ];

  test("segment widths are the shares, in chart colour order", () => {
    const html = render(fenceOf("split", { parts }));
    expect(widths(html)).toEqual([60, 30, 10]);
    expect([...html.matchAll(/--c:var\(--chart-(\d)\)/g)].map((m) => m[1])).toEqual(["1", "2", "3", "1", "2", "3"]);
    expect(html).not.toContain("tc-code");
  });

  test("the legend has real text: label, value and percentage", () => {
    const html = render(fenceOf("split", { parts }));
    expect(html).toContain("Opus");
    expect(html).toContain(">60<");
    expect(html).toContain("60%");
    expect(html).toContain("10%");
  });

  test("a tiny share is labelled <1% and the other part is not rounded up to 100%", () => {
    const html = render(fenceOf("split", { parts: [{ label: "A", value: 1 }, { label: "B", value: 1000 }] }));
    expect(html).toContain("&lt;1%");
    expect(html).toContain(">99%<");
  });

  test("a zero-sum split is shown as code", () => {
    const html = render(fenceOf("split", { parts: [{ label: "A", value: 0 }, { label: "B", value: 0 }] }));
    expect(html).toContain("tc-code");
  });

  test("an open split fence streams as a placeholder", () => {
    expect(render('```split\n{"parts":[{"label":"A"', true)).toContain("tc-visual-ph");
  });
});

describe("bars block", () => {
  const rows = [
    { label: "Alpha", value: 50 },
    { label: "Beta", value: 25, display: "a quarter" },
    { label: "Gamma", value: 0 },
  ];

  test("lengths scale to the largest value", () => {
    expect(widths(render(fenceOf("bars", { rows })))).toEqual([100, 50]); // the zero row has no fill
  });

  test("labels and printed values are real text; display replaces the number", () => {
    const html = render(fenceOf("bars", { rows }));
    expect(html).toContain("Alpha");
    expect(html).toContain(">50<");
    expect(html).toContain("a quarter");
    expect(html).not.toContain(">25<");
  });

  test("all-zero rows render with no division by zero", () => {
    expect(widths(render(fenceOf("bars", { rows: [{ label: "A", value: 0 }] })))).toEqual([]);
  });

  test("more than twelve rows is shown as code", () => {
    const html = render(fenceOf("bars", { rows: Array.from({ length: 13 }, (_, i) => ({ label: `r${i}`, value: i })) }));
    expect(html).toContain("tc-code");
  });

  test("an open bars fence streams as a placeholder; a finished one shows code", () => {
    const open = '```bars\n{"rows":[{"label":"A","value":1}]}';
    expect(render(open, true)).toContain("tc-visual-ph");
    expect(render(open, false)).toContain("tc-code");
  });
});
