// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import { ToolChecklist, useToolPicker } from "./ToolPicker";

// No servers or skills, and add_skill switched off for new threads.
vi.mock("convex/react", () => ({
  useQuery: (q: FunctionReference<"query">) =>
    ({ "toolServers:list": [], "skills:list": [], "settings:get": { addSkillOnForNewThreads: false } })[getFunctionName(q)],
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const picker = useToolPicker(true);
  return (
    <>
      <output>{JSON.stringify(picker.picks)}</output>
      <ToolChecklist servers={picker.servers} skills={picker.skills} chosen={picker.chosen} onChange={picker.setChosen} />
    </>
  );
}

// Story 36: the add_skill setting is only the default; the owner can still pick it.
test("add_skill switched off is unpicked by default but can still be picked", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => createRoot(el).render(<Harness />));
  expect(el.querySelector("output")!.textContent).toBe("[]");
  const box = el.querySelector<HTMLElement>('[role="checkbox"]')!;
  expect(box.closest("label")!.textContent).toContain("add_skill");
  expect(box.getAttribute("aria-disabled")).toBeNull();
  await act(() => box.closest("label")!.click());
  expect(el.querySelector("output")!.textContent).toBe(JSON.stringify([{ builtin: "add_skill" }]));
});
