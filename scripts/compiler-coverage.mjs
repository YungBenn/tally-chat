// Runs React Compiler over every component and hook and fails on any bailout or error.
// ESLint doesn't report these, so a component can silently stop being compiled. Part of `npm run lint`.
import { transformSync } from "@babel/core";
import { globSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Compiler events for `code` that aren't a successful compile, as "file:line message" strings. */
export function compilerProblems(code, filename) {
  const problems = [];
  transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      [
        "babel-plugin-react-compiler",
        {
          panicThreshold: "none",
          logger: {
            logEvent(_file, event) {
              if (event.kind === "CompileSuccess") return;
              const detail = event.detail?.options ?? event.detail ?? {};
              const reason = detail.reason ?? event.reason ?? event.data ?? event.kind;
              // Where the compiler gave up, else the function it skipped.
              const loc = detail.loc ?? detail.details?.find((d) => d.loc)?.loc ?? event.fnLoc;
              const line = loc?.start?.line ?? "?";
              problems.push(`${filename}:${line} ${event.kind}: ${reason}`);
            },
          },
        },
      ],
    ],
  });
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = globSync("{app,components,lib}/**/*.{ts,tsx}");
  const problems = files.flatMap((f) => compilerProblems(readFileSync(f, "utf8"), f));
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`React Compiler: ${problems.length} problem(s) in ${files.length} files.`);
    process.exit(1);
  }
  console.log(`React Compiler: all components and hooks in ${files.length} files compile.`);
}
