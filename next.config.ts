import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  devIndicators: false,
  // Isolate browser QA from a developer's running workspace server.
  distDir: process.env.BACKLOG_BUILD_DIR || ".next",
  typescript: { tsconfigPath: process.env.BACKLOG_TSCONFIG || "tsconfig.json" },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return ["/verify-email", "/reset-password", "/forgot-password", "/google-auth", "/api/auth/google/:path*"].map(source => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
