import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  css: { postcss: {} }, // tests import stylesheets but never style; skip the app's Tailwind pipeline
  test: {
    environment: "edge-runtime",
    setupFiles: ["./test/noNetwork.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
