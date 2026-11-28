import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import convexPlugin from "@convex-dev/eslint-plugin";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...convexPlugin.configs.recommended,
  globalIgnores([".claude/**"]), // agent worktrees
  {
    rules: {
      // AppProviders loads motion's features lazily (LazyMotion strict); the full `motion` component
      // would pull them all into the first load.
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "motion/react", importNames: ["motion"], message: "Use `m` from motion/react-m." }] },
      ],
    },
  },
]);
