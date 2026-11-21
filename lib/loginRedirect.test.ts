import { expect, test } from "vitest";
import { loginRedirect } from "./loginRedirect";

const now = Date.UTC(2026, 10, 21, 12, 0, 0);
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// The check never verifies the signature (Convex does), so a fake one is fine.
const jwt = (payload: object) =>
  `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.c2ln`;
const valid = jwt({ sub: "u|s", iat: now / 1000 - 60, exp: now / 1000 + 3600 });
const expired = jwt({ sub: "u|s", iat: now / 1000 - 7200, exp: now / 1000 - 1 });

test("a valid token reaches the page", () => {
  expect(loginRedirect("/thread/abc", valid, now)).toBeNull();
});

test("a missing token goes to sign-in", () => {
  expect(loginRedirect("/thread/abc", undefined, now)).toBe("/signin");
});

test("an expired token goes to sign-in", () => {
  expect(loginRedirect("/", expired, now)).toBe("/signin");
});

test("a token expiring exactly now counts as expired", () => {
  expect(loginRedirect("/", jwt({ exp: now / 1000 }), now)).toBe("/signin");
});

test.each([
  ["not a jwt", "garbage"],
  ["bad base64 payload", "a.!!!.c"],
  ["payload not json", `a.${b64url("nope")}.c`],
  ["no exp claim", jwt({ sub: "u|s" })],
  ["non-numeric exp", jwt({ exp: "soon" })],
  ["empty string", ""],
])("a malformed token goes to sign-in (%s)", (_, token) => {
  expect(loginRedirect("/", token, now)).toBe("/signin");
});

test("the sign-in page sends a logged-in owner home", () => {
  expect(loginRedirect("/signin", valid, now)).toBe("/");
});

test("the sign-in page stays put without a valid login", () => {
  expect(loginRedirect("/signin", undefined, now)).toBeNull();
  expect(loginRedirect("/signin", expired, now)).toBeNull();
  expect(loginRedirect("/signin", "garbage", now)).toBeNull();
});
