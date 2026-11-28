import { transformAsync } from "@babel/core";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  css: { postcss: {} }, // tests import stylesheets but never style; skip the app's Tailwind pipeline
  plugins: [
    {
      // Components run through the React Compiler like the production build, so tests see its memoization.
      name: "react-compiler",
      enforce: "pre",
      async transform(code, id) {
        if (!/\/(app|components|lib)\/.*\.tsx$/.test(id) || id.includes("node_modules")) return;
        const out = await transformAsync(code, {
          filename: id,
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ["typescript", "jsx"] },
          plugins: [["babel-plugin-react-compiler", {}]],
          sourceMaps: true,
        });
        return out?.code ? { code: out.code, map: out.map } : undefined;
      },
    },
  ],
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"], // agent worktrees
    environment: "edge-runtime",
    // Convex tests run real scheduled work, which a loaded machine slows past the 5 s default.
    testTimeout: 30_000,
    setupFiles: ["./test/noNetwork.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
