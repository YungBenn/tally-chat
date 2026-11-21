// @vitest-environment node
import { expect, test } from "vitest";
import { compilerProblems } from "./compiler-coverage.mjs";

test("a component the compiler accepts reports nothing", () => {
  const code = `export function Hello({ name }: { name: string }) {
    return <p>{name ? "Hi " + name : "Hi"}</p>;
  }`;
  expect(compilerProblems(code, "Hello.tsx")).toEqual([]);
});

test("a component that bails out is reported at the line the compiler gave up on", () => {
  const code = `
export function Send({ send, alt }: { send: (n: number) => Promise<void>; alt: boolean }) {
  const onClick = async () => {
    try {
      await send(alt ? 1 : 2);
    } catch {}
  };
  return <button onClick={onClick} />;
}`;
  expect(compilerProblems(code, "Send.tsx")).toEqual([
    "Send.tsx:5 CompileError: Support value blocks (conditional, logical, optional chaining, etc) within a try/catch statement",
  ]);
});
