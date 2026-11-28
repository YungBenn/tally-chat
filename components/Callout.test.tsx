// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import Markdown from "./Markdown";

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("callouts", () => {
  test.each([
    ["NOTE", "note", "Note"],
    ["TIP", "tip", "Tip"],
    ["IMPORTANT", "important", "Important"],
    ["WARNING", "warning", "Warning"],
    ["CAUTION", "caution", "Caution"],
  ])("[!%s] renders a %s callout with its title and without the marker", (marker, kind, title) => {
    const html = render(`> [!${marker}]\n> Mind the gap.`);
    expect(html).toContain(`data-callout="${kind}"`);
    expect(html).toContain(`>${title}</`);
    expect(html).toContain("Mind the gap.");
    expect(html).not.toContain("[!");
    expect(html).not.toContain("<blockquote");
  });

  test("keeps inline markdown and later paragraphs in the body", () => {
    const html = render("> [!TIP]\n> Use **bold** here.\n>\n> Second paragraph.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("Second paragraph.");
  });

  test("an unknown kind stays a plain quote", () => {
    const html = render("> [!DANGER]\n> Nope.");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("data-callout");
    expect(html).toContain("[!DANGER]");
  });

  test("an ordinary quote is untouched", () => {
    const html = render("> Just a quote.");
    expect(html).toContain("<blockquote");
    expect(html).not.toContain("data-callout");
  });

  test("a marker line ending in a hard break leaves no leading <br>", () => {
    const html = render("> [!NOTE]  \n> Mind the gap.");
    expect(html).toContain('data-callout="note"');
    expect(html).not.toContain("<br");
  });

  test("a marker that is not alone on its line stays a quote", () => {
    expect(render("> [!NOTE] inline")).toContain("<blockquote");
  });

  test("is stable while streaming: a complete marker line is already a callout", () => {
    expect(render("> [!WARNING]")).toContain('data-callout="warning"');
    expect(render("> [!WARNING]\n> Wat")).toContain('data-callout="warning"');
    expect(render("> [!WARNING]\n> Wat")).toContain("Wat");
  });
});
