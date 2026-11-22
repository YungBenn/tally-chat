// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { loadKatex } from "@/lib/katex";
import Markdown from "./Markdown";

const text = "Euler: \\(e^{i\\pi} + 1 = 0\\).\n\n\\[x^2\\]";
const render = () => renderToStaticMarkup(<Markdown text={text} />);

// One test, in order: KaTeX is module state that only loads once.
test("math shows as monospace source until KaTeX loads, then as typeset math", async () => {
  const before = render();
  expect(before).toContain("<code>e^{i\\pi} + 1 = 0</code>");
  expect(before).toContain("<code>x^2</code>");
  expect(before).not.toContain('class="katex"');

  await loadKatex();
  const after = render();
  expect(after).toContain('class="katex"');
  expect(after).toContain('class="katex-display"');
  expect(after).toContain("<annotation encoding=\"application/x-tex\">e^{i\\pi} + 1 = 0</annotation>");
  expect(after).not.toContain("<code>");
});
