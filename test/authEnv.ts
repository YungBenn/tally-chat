import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

// Convex Auth needs signing keys to issue tokens, and the vault needs a master
// key; convex-test reads env from process.env.
export async function setAuthEnv() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });
  process.env.SITE_URL = "http://localhost:3000";
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
  process.env.TALLY_MASTER_KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}
