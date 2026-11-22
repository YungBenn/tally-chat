// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import ChatShell, { AppShell } from "./ChatShell";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: vi.fn(async () => ({ titles: [], messages: [] })) }),
  useQuery: () => undefined,
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The shared layout keeps the sidebar mounted while pages change under it, so its state (here the
// search box) survives moving between pages (Phase 12 ticket 10).
test("the sidebar keeps its state when the page under the shell changes", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const page = (name: string) => (
    <AppShell>
      <ChatShell header={<h1>{name}</h1>}>
        <p>{name} body</p>
      </ChatShell>
    </AppShell>
  );
  await act(() => root.render(page("Usage")));
  const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "cache");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(() => root.render(page("Tools")));
  expect(el.textContent).toContain("Tools body");
  expect(el.querySelector("h1")?.textContent).toBe("Tools");
  expect(el.querySelector<HTMLInputElement>('input[type="search"]')).toBe(search);
  expect(search.value).toBe("cache");
});
