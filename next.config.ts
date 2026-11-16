import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e2e run builds into its own folder, so it can't replace the .next a running server reads from. Unset everywhere else.
  distDir: process.env.KESTREL_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  devIndicators: false,
  // The proxy buffers request bodies and cuts them at this size; attachments go up to 10 MB plus multipart wrapping.
  experimental: { proxyClientMaxBodySize: "11mb" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The site's home page moved from /welcome; old links and bookmarks still land on it.
  async redirects() {
    return [
      { source: "/welcome", destination: "/home", permanent: true },
      { source: "/welcome/:section", destination: "/home/:section", permanent: true },
    ];
  },
  // The Content-Security-Policy is set per request in src/proxy.ts: it carries a fresh nonce each time.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
