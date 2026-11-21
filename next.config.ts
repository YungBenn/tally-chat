import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the production image (phase 5): only the files it needs.
  output: "standalone",
  // Memoizes components and hooks at build time, so renders skip work whose inputs didn't change.
  reactCompiler: true,
  // The build script runs TypeScript 7 before Next.js. Next still needs the
  // older TypeScript compiler API for configuration and editor tooling.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
