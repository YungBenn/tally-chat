// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import Composer from "./Composer";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useQuery: () => undefined,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.useRealTimers());

// Types into the controlled textarea the way a browser does: set the value, fire `input`.
function type(box: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, value);
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

// The draft lives in the composer: the page hears it only once typing settles, so a keystroke
// re-renders the composer alone (Phase 12 ticket 05).
test("the composer reports its draft once typing settles, not on every keystroke", async () => {
  vi.useFakeTimers();
  const onDraftChange = vi.fn();
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => createRoot(el).render(<Composer onSend={async () => {}} onDraftChange={onDraftChange} />));
  await act(() => vi.advanceTimersByTime(1000));
  onDraftChange.mockClear();

  const box = el.querySelector("textarea")!;
  for (const value of ["h", "he", "hel", "hell", "hello"]) {
    await act(() => type(box, value));
    await act(() => vi.advanceTimersByTime(50));
  }
  expect(box.value).toBe("hello");
  expect(onDraftChange).not.toHaveBeenCalled();

  await act(() => vi.advanceTimersByTime(200));
  expect(onDraftChange.mock.calls).toEqual([["hello"]]);
});

async function mount(onSend: () => Promise<unknown>) {
  const el = document.createElement("div");
  document.body.append(el);
  await act(() => createRoot(el).render(<Composer onSend={onSend} />));
  const box = el.querySelector("textarea")!;
  await act(() => type(box, "my question"));
  return { el, box };
}

const send = (el: HTMLElement) => act(() => el.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());

// Optimistic send (Phase 12 ticket 08): the composer clears the instant I press Send.
test("the composer clears as soon as Send is pressed, before the send settles", async () => {
  const { el, box } = await mount(() => new Promise(() => {}));
  await send(el);
  expect(box.value).toBe("");
});

test("a failed send puts my text back and shows the error", async () => {
  let fail!: (e: Error) => void;
  const { el, box } = await mount(() => new Promise((_, reject) => (fail = reject)));
  await send(el);
  expect(box.value).toBe("");
  await act(async () => fail(new Error("Add an API key for this provider")));
  expect(box.value).toBe("my question");
  expect(el.querySelector('[role="alert"]')?.textContent).toBe("Add an API key for this provider");
});

test("a budget refusal restores the text and leaves the message to the budget banner", async () => {
  const { el, box } = await mount(() => Promise.reject(new Error("Daily budget reached")));
  await send(el);
  expect(box.value).toBe("my question");
  expect(el.querySelector('[role="alert"]')).toBeNull();
});
