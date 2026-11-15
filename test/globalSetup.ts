import type { TestProject } from "vitest/node";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

declare module "vitest" {
  export interface ProvidedContext {
    authEnv: Record<string, string>;
  }
}

// Convex Auth needs signing keys and the vault a master key. RSA key generation is slow, so it
// runs once here instead of in every test file (doing it per file timed out under load).
export default async function setup(project: TestProject) {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  project.provide("authEnv", {
    JWT_PRIVATE_KEY: (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] }),
    SITE_URL: "http://localhost:3000",
    CONVEX_SITE_URL: "http://127.0.0.1:3211",
    TALLY_MASTER_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
  });
}
