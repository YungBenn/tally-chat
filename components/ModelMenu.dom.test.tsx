// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import ModelMenu from "./ModelMenu";

// Convex's hooks as they behave when the pricing query fails on the server: useQuery throws the
// error during render, useQueries hands it back as the query's value.
const failure = new Error("Too many bytes read");
const failing = (q: FunctionReference<"query">) => getFunctionName(q) === "inspector:modelEstimates";
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (q: FunctionReference<"query">, args: unknown) => {
    if (failing(q) && args !== "skip") throw failure;
    return getFunctionName(q) === "providers:list" ? [] : undefined;
  },
  useQueries: (queries: Record<string, { query: FunctionReference<"query"> }>) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query }]) => [key, failing(query) ? failure : undefined]),
    ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The Retry-with list prices each model on the server; when that fails, the menu says so and the
// thread page around it keeps working.
test("a failing price query shows an error inside the menu instead of throwing", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(() =>
    root.render(
      <ModelMenu
        trigger={<button type="button">Retry with</button>}
        title="Retry with"
        threadId={"t1" as Id<"threads">}
        maxOutputTokens={4000}
        onPick={() => {}}
        defaultOpen
      />,
    ),
  );
  expect(document.body.textContent).toContain("Couldn't price the models.");
  await act(() => root.unmount());
});
