// @vitest-environment happy-dom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import Composer from "./Composer";

const fromSkill = vi.fn(async () => ({ documentId: "doc1", name: "house-style", tokens: 12 }));
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "documents:fromSkill" ? fromSkill : vi.fn(),
  useAction: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "skills:list"
      ? [
          { _id: "s1", name: "house-style", description: "How we write." },
          { _id: "s2", name: "release-notes", description: "Release notes." },
        ]
      : undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(box: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, value);
  box.setSelectionRange(value.length, value.length);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

test("typing / lists skills; choosing one attaches a frozen copy and sends it", async () => {
  const onSend = vi.fn(async () => {});
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => createRoot(el).render(<Composer onSend={onSend} />));
  const box = el.querySelector("textarea")!;

  await act(() => type(box, "/hou"));
  const options = [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options).toEqual(["/house-styleHow we write."]);

  await act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(fromSkill).toHaveBeenCalledWith({ skillId: "s1" });
  expect(box.value).toBe("");
  expect(el.querySelector(".tc-attach")?.textContent).toContain("house-style");

  await act(() => type(box, "Write an intro"));
  await act(() => el.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(onSend).toHaveBeenCalledWith("Write an intro", [], ["doc1"], {
    images: [],
    documents: [{ name: "house-style", tokens: 12, fromThreadId: undefined, fromSkillId: "s1" }],
  });
});
