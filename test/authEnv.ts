import { inject } from "vitest";

// Convex Auth's signing keys and the vault's master key, generated once per run in
// test/globalSetup.ts; convex-test reads env from process.env.
export async function setAuthEnv() {
  Object.assign(process.env, inject("authEnv"));
}
