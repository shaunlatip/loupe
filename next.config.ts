import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Museum images come from many CDNs — plain <img> is used throughout,
  // so no remotePatterns config is needed.
  turbopack: {
    root: __dirname,
  },
  // dev/start bind port 4050 (see package.json scripts)
};

export default nextConfig;
