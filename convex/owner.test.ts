/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { setAuthEnv } from "../test/authEnv";
import { fakeFetch } from "../test/fakeFetch";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeAll(setAuthEnv);

const signIn = (t: ReturnType<typeof convexTest>, flow: "signUp" | "signIn", password: string) =>
  t.action(api.auth.signIn, { provider: "password", params: { flow, password } });

describe("owner setup and login", () => {
  test("fresh instance needs setup; first sign-up claims it", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.owner.setupStatus, {})).toEqual({ needsSetup: true });

    const result = await signIn(t, "signUp", "correct horse battery");
    expect(result.tokens).toBeTruthy();
    expect(await t.query(api.owner.setupStatus, {})).toEqual({ needsSetup: false });
  });

  test("setup cannot be repeated once the owner exists", async () => {
    const t = convexTest(schema, modules);
    await signIn(t, "signUp", "correct horse battery");
    await expect(signIn(t, "signUp", "attacker password")).rejects.toThrow(/already exists/);
  });

  test("owner can log in with the password, and a wrong password is refused", async () => {
    const t = convexTest(schema, modules);
    await signIn(t, "signUp", "correct horse battery");
    expect((await signIn(t, "signIn", "correct horse battery")).tokens).toBeTruthy();
    await expect(signIn(t, "signIn", "wrong password")).rejects.toThrow();
  });

  test("owner functions reject unauthenticated calls", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.owner.me, {})).rejects.toThrow("Not logged in");
  });

  test("owner functions resolve the logged-in owner", async () => {
    const t = convexTest(schema, modules);
    await signIn(t, "signUp", "correct horse battery");
    const ownerId = await t.run(async (ctx) => (await ctx.db.query("users").first())!._id);
    const asOwner = t.withIdentity({ subject: `${ownerId}|session` });
    expect(await asOwner.query(api.owner.me, {})).toEqual({ ownerId });
  });
});

describe("fakeFetch harness", () => {
  test("replays a recorded response and captures the request body", async () => {
    const fake = fakeFetch({ "POST https://api.example.test/v1/x": { body: { ok: true } } });
    try {
      const res = await fetch("https://api.example.test/v1/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
      expect(await res.json()).toEqual({ ok: true });
      expect(fake.requests).toEqual([{ method: "POST", url: "https://api.example.test/v1/x", body: { a: 1 } }]);
    } finally {
      fake.restore();
    }
  });
});
