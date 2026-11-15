// One-shot setup for the docker compose stack (spec phase 5). Runs on every `up`, after the
// backend is healthy and before the web app starts:
//   1. creates tally.chat's secrets on first run (the master key that encrypts provider keys and
//      Convex Auth's signing keys) and reuses them afterwards;
//   2. derives the Convex admin key from the backend's own instance secret;
//   3. sets the deployment's environment, deploys the functions (also the upgrade path) and runs
//      the data backfills.
// Secrets live in /secrets (selfhost/secrets on the host): back that directory up with the data.
// `setup.ts backup <dir>` and `setup.ts restore <dir> [--replace-secrets]` back the instance up
// and restore it (run through selfhost/backup.sh and selfhost/restore.sh).
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const SECRETS = "/secrets/tally.env";
const CONVEX_CREDENTIALS = "/secrets/convex";
const backendUrl = process.env.CONVEX_SELF_HOSTED_URL ?? "http://backend:3210";
const siteUrl = required("SITE_URL");

function required(name: string) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value!;
}

function fail(message: string): never {
  console.error(`setup: ${message}`);
  process.exit(1);
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), JSON.parse(line.slice(i + 1))];
      }),
  );
}

async function appSecrets() {
  const existing = readEnvFile(SECRETS);
  if (existing.TALLY_MASTER_KEY && existing.JWT_PRIVATE_KEY && existing.JWKS) {
    console.log("setup: reusing the existing secrets");
    return existing;
  }
  console.log("setup: first run, generating secrets");
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const secrets = {
    TALLY_MASTER_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"),
    JWT_PRIVATE_KEY: (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] }),
  };
  const body = Object.entries(secrets)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n");
  writeFileSync(
    SECRETS,
    `# tally.chat secrets, generated on first run. Back this file up: without TALLY_MASTER_KEY,\n# stored provider keys can't be decrypted.\n${body}\n`,
    { mode: 0o600 },
  );
  return secrets;
}

function adminKey() {
  // The backend writes its instance secret readable by everyone; it's as sensitive as the admin key.
  spawnSync("chmod", ["600", `${CONVEX_CREDENTIALS}/instance_secret`]);
  const read = (name: string) => {
    const path = `${CONVEX_CREDENTIALS}/${name}`;
    if (!existsSync(path)) fail(`${path} is missing: has the backend started with CREDENTIALS_DIR set?`);
    return readFileSync(path, "utf8").trim();
  };
  const result = spawnSync("convex-generate-key", [read("instance_name"), read("instance_secret")], { encoding: "utf8" });
  if (result.status !== 0) fail(`could not derive the admin key: ${result.stderr}`);
  return result.stdout.trim();
}

function convex(args: string[], env: Record<string, string>) {
  const result = spawnSync("bunx", ["convex", ...args], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`convex ${args[0]} ${args[1] ?? ""} failed`);
}

function deploy(secrets: Record<string, string>, deployment: Record<string, string>) {
  // The deployment needs its environment before the functions deploy (TALLY_MASTER_KEY is required).
  for (const [name, value] of Object.entries({ ...secrets, SITE_URL: siteUrl })) {
    console.log(`setup: setting ${name}`);
    convex(["env", "set", "--", name, value], deployment);
  }
  console.log("setup: deploying the functions");
  convex(["deploy", "--yes", "--typecheck", "disable"], deployment);
  // Data backfills for the deployed schema; each skips rows it already filled, so reruns are no-ops.
  console.log("setup: running backfills");
  convex(["run", "migrations:backfillThreadStartedAt", "{}"], deployment);
}

// A backup is a directory holding data.zip (a Convex export, file storage included) and
// tally.env (this instance's secrets): restored data needs the master key that encrypted it.
function backup(dir: string, deployment: Record<string, string>) {
  if (!existsSync(SECRETS)) fail(`${SECRETS} is missing: has the stack been set up?`);
  console.log(`backup: exporting the data`);
  convex(["export", "--include-file-storage", "--path", `${dir}/data.zip`], deployment);
  copyFileSync(SECRETS, `${dir}/tally.env`);
  for (const file of ["data.zip", "tally.env"]) chmodSync(`${dir}/${file}`, 0o600);
  console.log("backup: done");
}

function restore(dir: string, replaceSecrets: boolean, deployment: Record<string, string>) {
  for (const file of ["data.zip", "tally.env"])
    if (!existsSync(`${dir}/${file}`)) fail(`${dir}/${file} is missing: a backup holds data.zip and tally.env`);
  const backupKey = readEnvFile(`${dir}/tally.env`).TALLY_MASTER_KEY;
  if (!backupKey) fail(`${dir}/tally.env has no TALLY_MASTER_KEY`);
  const currentKey = readEnvFile(SECRETS).TALLY_MASTER_KEY;
  if (currentKey && currentKey !== backupKey && !replaceSecrets)
    fail(
      "this instance's secrets don't match the backup's, so its provider keys couldn't be decrypted. " +
        "To replace this instance with the backup (data and secrets), run the restore again with --replace-secrets.",
    );
  copyFileSync(`${dir}/tally.env`, SECRETS);
  chmodSync(SECRETS, 0o600);
  deploy(readEnvFile(SECRETS), deployment);
  console.log("restore: importing the data (replaces everything in the deployment)");
  convex(["import", "--replace-all", "--yes", `${dir}/data.zip`], deployment);
  console.log("restore: done");
}

const [mode, dir, flag] = process.argv.slice(2);
const deployment = { CONVEX_SELF_HOSTED_URL: backendUrl, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey() };
if (mode === "backup") backup(dir, deployment);
else if (mode === "restore") restore(dir, flag === "--replace-secrets", deployment);
else {
  deploy(await appSecrets(), deployment);
  console.log("setup: done");
}
