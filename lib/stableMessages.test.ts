import { expect, test } from "vitest";
import { reuseUnchanged } from "./stableMessages";

const msg = (id: string, text: string, extra: object = {}) => ({
  _id: id,
  text,
  siblingIds: [id],
  usage: { inputTokens: 10, outputTokens: 5 },
  ...extra,
});

test("a message equal to its previous version keeps the previous object", () => {
  const prev = [msg("a", "hi"), msg("b", "hello")];
  const next = [msg("a", "hi"), msg("b", "hello")]; // a fresh query result, same content
  const out = reuseUnchanged(prev, next);
  expect(out[0]).toBe(prev[0]);
  expect(out[1]).toBe(prev[1]);
});

test("a changed message is the new object; the others keep theirs", () => {
  const prev = [msg("a", "hi"), msg("b", "hello", { status: "streaming" })];
  const next = [msg("a", "hi"), msg("b", "hello there", { status: "done" })];
  const out = reuseUnchanged(prev, next);
  expect(out[0]).toBe(prev[0]);
  expect(out[1]).toBe(next[1]);
});

test("a change deep inside a message counts, and so does a new or dropped field", () => {
  const prev = [msg("a", "hi"), msg("b", "x"), msg("c", "y", { pinned: true })];
  const next = [
    msg("a", "hi", { usage: { inputTokens: 10, outputTokens: 6 } }),
    msg("b", "x", { siblingIds: ["b", "b2"] }),
    { _id: "c", text: "y", siblingIds: ["c"], usage: { inputTokens: 10, outputTokens: 5 } },
  ];
  const out = reuseUnchanged(prev, next);
  expect(out[0]).toBe(next[0]);
  expect(out[1]).toBe(next[1]);
  expect(out[2]).toBe(next[2]);
});

test("new messages pass through, matched by id not position", () => {
  const prev = [msg("a", "hi"), msg("b", "hello")];
  const next = [msg("b", "hello"), msg("c", "new")];
  const out = reuseUnchanged(prev, next);
  expect(out[0]).toBe(prev[1]);
  expect(out[1]).toBe(next[1]);
});

test("with nothing changed, the previous array itself comes back", () => {
  const prev = [msg("a", "hi")];
  expect(reuseUnchanged(prev, [msg("a", "hi")])).toBe(prev);
  expect(reuseUnchanged(undefined, prev)).toBe(prev);
});
