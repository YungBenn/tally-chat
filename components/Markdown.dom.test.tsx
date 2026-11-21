// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import Markdown from "./Markdown";

// A mounted reply re-renders in place once Shiki loads, through the compiler's memoized render.
test("a code block in a mounted reply becomes highlighted once Shiki loads", async () => {
  const el = document.createElement("div");
  createRoot(el).render(<Markdown text={"```js\nconst answer = 42;\n```"} />);
  await vi.waitFor(() => expect(el.querySelector("pre")?.textContent).toContain("const answer = 42;"));
  await vi.waitFor(() => expect(el.querySelector('pre span[style*="--code-keyword"]')?.textContent).toBe("const"), { timeout: 10_000 });
}, 15_000);
