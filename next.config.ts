import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the production image (phase 5): only the files it needs.
  output: "standalone",
  // The build script runs TypeScript 7 before Next.js. Next still needs the
  // older TypeScript compiler API for configuration and editor tooling.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
