import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Museum images come from many CDNs — plain <img> is used throughout,
  // so no remotePatterns config is needed.
  turbopack: {
    root: __dirname,
  },
  // The Claude Agent SDK is used only on the local engine (see src/lib/engine.ts)
  // and spawns the `claude` CLI — never bundle it; require it from node_modules
  // at runtime. On Vercel it ships (~5MB) but is never imported.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
