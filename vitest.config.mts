import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    setupFiles: ["./test/noNetwork.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
