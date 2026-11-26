// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import MessageRow, { ThreadRowContext, type ThreadMessage } from "./MessageRow";

const queried = vi.fn((...args: unknown[]) => void args);
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => queried(...args),
  // A query in useQueries is one more subscription; "skip" passes none.
  useQueries: (queries: Record<string, { query: unknown; args: unknown }>) => {
    for (const { query, args } of Object.values(queries)) queried(query, args);
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
function mount(message = reply) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  unmount = () => act(() => root.unmount());
  act(() =>
    root.render(
      <ThreadRowContext value={ctx}>
        <MessageRow message={message}highlighted={false} isLast breakCost={null} editRequest={null} />
      </ThreadRowContext>,
    ),
  );
  return el;
}

const subscribed = () => queried.mock.calls.filter((c) => c[1] !== "skip").length;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!;

afterEach(() => {
  unmount();
  queried.mockClear();
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

test("Retry at higher effort shows only when the reply has a next level, and prices on open", async () => {
  mount();
  expect(button("Retry at higher effort")).toBeNull();
  unmount();
  (reply as { retryEffort?: string }).retryEffort = "high";
  mount();
  expect(subscribed()).toBe(0);
  await act(async () => button("Retry at higher effort").click());
  expect(document.body.textContent).toContain("Retry at high effort");
  expect(subscribed()).toBeGreaterThan(0);
  delete (reply as { retryEffort?: string }).retryEffort;
});

test("a reply cut off while thinking offers the two retries and no Continue", () => {
  const cut = { ...reply, truncated: true, truncatedThinking: true, retryLowerEffort: "medium" } as unknown as ThreadMessage;
  mount(cut);
  const text = () => document.body.textContent;
  expect(text()).toContain("Cut off while thinking");
  expect(text()).toContain("Retry at lower effort");
  expect(text()).toContain("Retry in long mode");
  expect(text()).not.toContain("Continue");
  unmount();
  mount({ ...cut, retryLowerEffort: undefined, outputMode: "long" } as ThreadMessage);
  expect(text()).not.toContain("Retry at lower effort");
  expect(text()).not.toContain("Retry in long mode");
  unmount();
  mount({ ...reply, truncated: true } as ThreadMessage);
  expect(text()).toContain("Continue");
});

test("a stored thinking summary is collapsed above the answer and expands on press", async () => {
  mount({ ...reply, thinking: "Weighing the options." });
  const head = document.querySelector<HTMLButtonElement>(".tc-thinking-summary-head")!;
  expect(head.getAttribute("aria-expanded")).toBe("false");
  expect(document.body.textContent).not.toContain("Weighing the options.");
  await act(async () => head.click());
  expect(document.body.textContent).toContain("Weighing the options.");
});

test("a reply with no thinking shows no summary", () => {
  mount();
  expect(document.querySelector(".tc-thinking-summary-head")).toBeNull();
});

test("the reply details open on the first press", async () => {
  mount();
  await act(async () => button("Cost breakdown").click());
  expect(document.body.textContent).toContain("This reply ·");
});
