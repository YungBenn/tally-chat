import { defineApp } from "convex/server";
import { v } from "convex/values";
import persistentTextStreaming from "@convex-dev/persistent-text-streaming/convex.config.js";

const app = defineApp({
  env: {
    // base64 of 32 random bytes; encrypts provider keys at rest (convex/lib/vault.ts).
    TALLY_MASTER_KEY: v.string(),
  },
});
app.use(persistentTextStreaming);

export default app;
