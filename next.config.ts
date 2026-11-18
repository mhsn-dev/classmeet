import type { NextConfig } from "next";

/**
 * Build modes:
 *  - default (dev / standalone server): normal Node server build
 *  - PAGES_BUILD=1  → static export with basePath (GitHub Pages project site)
 *  - STATIC_BUILD=1 → static export without basePath (self-host / Docker / VPS)
 */
const isStatic = process.env.PAGES_BUILD === "1" || process.env.STATIC_BUILD === "1";
const basePath = process.env.NEXT_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  ...(isStatic ? { output: "export" as const } : { output: "standalone" as const }),
  basePath,
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
