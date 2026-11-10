import type { MetadataRoute } from "next";

const base = process.env.SITE_URL || "http://localhost:3100";

/** Crawlers may read the marketing pages and nothing of the application. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/welcome", "/platform", "/features", "/about", "/contact"], disallow: ["/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
