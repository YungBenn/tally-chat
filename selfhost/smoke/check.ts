// The smoke check (spec phase 5): drives a running stack through the same calls the browser
// makes, and exits non-zero at the first failing step. Run it with selfhost/smoke.sh.
import { setTimeout as sleep } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const WEB = process.env.SMOKE_WEB_URL ?? "http://web:3000";
const CONVEX = process.env.SMOKE_CONVEX_URL ?? "http://backend:3210";
const client = new ConvexHttpClient(CONVEX);

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    console.log(`ok   ${name}`);
    return result;
  } catch (err) {
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

await step("the app answers", async () => {
  const res = await fetch(`${WEB}/signin`);
  check(res.ok, `GET /signin returned ${res.status}`);
});

await step("a fresh install shows the set-password page", async () => {
  const { needsSetup } = await client.query(api.owner.setupStatus, {});
  check(needsSetup, "the instance already has an owner, so this isn't a fresh install");
});

await step("the owner sets a password", async () => {
  const result = await client.action(api.auth.signIn, {
    provider: "password",
    params: { flow: "signUp", password: "smoke-check-password" },
  });
  check(result.tokens?.token, "sign-up returned no session token");
  client.setAuth(result.tokens.token);
});

const providerId = await step("a provider is added (allowlisted fake server)", async () => {
  await client.mutation(api.settings.addAllowedHost, { host: "fake:8080" });
  return client.action(api.providerActions.add, {
    name: "Smoke",
    apiStyle: "openai-compatible",
    baseUrl: "http://fake:8080/v1",
    apiKey: "smoke",
  });
});

const threadId = await step("a message is sent", async () => {
  const threadId = await client.mutation(api.chat.createThread, { providerId, modelId: "gpt-5-mini" });
  await client.mutation(api.chat.send, { threadId, content: "Hello from the smoke check" });
  return threadId;
});

const reply = await step("the reply streams in", async () => {
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(500)) {
    const reply = (await client.query(api.chat.getThread, { threadId }))?.messages.find((m) => m.role === "assistant");
    if (reply?.status === "error") throw new Error(`the reply failed: ${reply.error}`);
    if (reply?.status === "done") {
      check(reply.text === "Smoke test reply", `unexpected reply text: ${JSON.stringify(reply.text)}`);
      return reply;
    }
  }
  throw new Error("no reply within 60 seconds");
});

await step("usage and cost are recorded", async () => {
  check(reply.usage && reply.costMicroUsd! > 0, "the reply has no usage or cost");
  const today = new Date().toISOString().slice(0, 10);
  const summary = await client.query(api.usage.summary, { today });
  check(summary.models.some((m) => m.model === "gpt-5-mini" && m.calls > 0), "the usage page shows no calls");
});

console.log("smoke check passed");
