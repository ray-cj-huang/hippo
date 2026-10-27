import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@hippo/ui", "@hippo/contracts"],
  reactStrictMode: true,
};

export default config;
