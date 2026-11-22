// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { loadLanguage } from "@/lib/highlight";
import Markdown from "./Markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A mounted reply re-renders in place once Shiki loads, through the compiler's memoized render.
// A busy machine only makes it slower: nothing waits on a short wall-clock deadline.
test("a code block in a mounted reply becomes highlighted once Shiki loads", async () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(() => root.render(<Markdown text={"```js\nconst answer = 42;\n```"} />));
  expect(el.querySelector("pre")?.textContent).toContain("const answer = 42;");
  expect(el.querySelector('pre span[style*="--code-keyword"]')).toBeNull();

  // Wait for the load the mounted block started (shared per language), however long it takes, then
  // for the re-render it triggers: a deadline only a broken test reaches, not a busy machine.
  await act(() => loadLanguage("js"));
  await vi.waitFor(
    () => expect(el.querySelector('pre span[style*="--code-keyword"]')?.textContent).toBe("const"),
    { timeout: 30_000 },
  );
  await act(() => root.unmount());
}, 60_000);
