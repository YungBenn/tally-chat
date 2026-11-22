// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import ChatShell, { AppShell } from "./ChatShell";

const THREAD = { _id: "t1", title: "Cached thread", pinned: false, startedAt: Date.now() };
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: vi.fn(async () => ({ titles: [], messages: [] })) }),
  useQuery: (q: FunctionReference<"query">) =>
    getFunctionName(q) === "chat:listThreads" ? [THREAD] : undefined,
}));
const cached = vi.hoisted(() => ({ calls: [] as [string, unknown][] }));
vi.mock("convex-helpers/react/cache/hooks", () => ({
  useQuery: (q: FunctionReference<"query">, args: unknown) => {
    cached.calls.push([getFunctionName(q), args]);
    return undefined;
  },
}));
const forThread = (id: string) =>
  cached.calls.filter(([, a]) => (a as { threadId?: string } | undefined)?.threadId === id).map(([n]) => n);
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }));
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => nav.pathname,
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

// Settings follow the URL hash, which a client navigation changes without a hashchange event:
// leaving the dialog through a link (Import history) must close it (Phase 12 ticket 10).
test("settings close when a link inside them navigates to another page", async () => {
  history.replaceState(null, "", "/#settings");
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const page = (name: string) => (
    <AppShell>
      <ChatShell>
        <p>{name}</p>
      </ChatShell>
    </AppShell>
  );
  await act(() => root.render(page("Home")));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  history.pushState(null, "", "/import");
  nav.pathname = "/import";
  await act(() => root.render(page("Import")));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

// Hovering a thread in the sidebar starts its subscriptions through the query cache, so the
// thread is loaded by the time it's clicked (Phase 12 ticket 11). Only what the page needs to
// paint: the inspector, the heaviest query, loads when the thread opens.
test("hovering a thread link subscribes to the thread's paint queries through the cache", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  cached.calls = [];
  await act(() =>
    root.render(
      <AppShell>
        <ChatShell>
          <p>Home</p>
        </ChatShell>
      </AppShell>,
    ),
  );
  const link = el.querySelector<HTMLAnchorElement>('a[href="/t/t1"]')!;
  expect(forThread("t1")).toEqual([]);

  await act(() => {
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  });
  expect(new Set(forThread("t1"))).toEqual(new Set(["chat:getThread", "threadState:cache"]));
});
