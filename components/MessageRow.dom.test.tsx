// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import MessageRow, { ThreadRowContext, type ThreadMessage } from "./MessageRow";

const useQuery = vi.fn((...args: unknown[]) => void args);
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  // A query in useQueries is one more subscription; "skip" passes none.
  useQueries: (queries: Record<string, { query: unknown; args: unknown }>) => {
    for (const { query, args } of Object.values(queries)) useQuery(query, args);
    return {};
  },
  useMutation: () => vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reply = {
  _id: "m1" as Id<"messages">,
  role: "assistant",
  status: "done",
  text: "Hello",
  siblingIds: ["m1"],
  pinned: false,
  pinLocked: false,
  modelName: "Sonnet",
  costMicroUsd: 1200,
  usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens5m: 0, cacheWriteTokens1h: 0, outputTokens: 5, reasoningTokens: 0 },
} as unknown as ThreadMessage;

const ctx = {
  threadId: "t1" as Id<"threads">,
  mode: "normal" as const,
  threadModel: null,
  confirmAbove: 0,
  onType: () => {},
  onContinue: () => {},
};

let unmount = () => {};
function mount() {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  unmount = () => act(() => root.unmount());
  act(() =>
    root.render(
      <ThreadRowContext value={ctx}>
        <MessageRow message={reply} highlighted={false} isLast breakCost={null} editRequest={null} />
      </ThreadRowContext>,
    ),
  );
  return el;
}

const subscribed = () => useQuery.mock.calls.filter((c) => c[1] !== "skip").length;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;

afterEach(() => {
  unmount();
  useQuery.mockClear();
});

// A long thread renders hundreds of rows; their closed menus must not each subscribe and build a picker.
test("a reply's menus subscribe to nothing until opened", () => {
  mount();
  expect(subscribed()).toBe(0);
});

test("Retry with opens the model picker on the first press", async () => {
  mount();
  await act(async () => button("Retry with another model").click());
  expect(document.body.textContent).toContain("Pricing…");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Search models");
  expect(subscribed()).toBeGreaterThan(0);
});

test("the reply details open on the first press", async () => {
  mount();
  await act(async () => button("Cost breakdown").click());
  expect(document.body.textContent).toContain("This reply ·");
});
