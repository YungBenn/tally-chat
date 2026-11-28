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
