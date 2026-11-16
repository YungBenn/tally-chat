import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the production image (phase 5): only the files it needs.
  output: "standalone",
  // The dev server serves its scripts to other origins only when listed: Tailscale addresses
  // (100.64.0.0/10, MagicDNS names) so `bun run dev` works from your other devices.
  allowedDevOrigins: ["100.*.*.*", "*.ts.net"],
  // The build script runs TypeScript 7 before Next.js. Next still needs the
  // older TypeScript compiler API for configuration and editor tooling.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
