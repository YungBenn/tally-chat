import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    // base64 of 32 random bytes; encrypts provider keys at rest (convex/lib/vault.ts).
    TALLY_MASTER_KEY: v.string(),
  },
});

export default app;
