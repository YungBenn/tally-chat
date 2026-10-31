import { env } from "../_generated/server";

// AES-256-GCM with the master key from the environment, never the database.
// Stored form: "v1.<iv base64>.<ciphertext base64>".
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function masterKey() {
  const raw = unb64(env.TALLY_MASTER_KEY);
  if (raw.length !== 32) throw new Error("TALLY_MASTER_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await masterKey(), new TextEncoder().encode(plaintext));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, iv, ct] = stored.split(".");
  if (version !== "v1") throw new Error("Unknown secret format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await masterKey(), unb64(ct));
  return new TextDecoder().decode(pt);
}
