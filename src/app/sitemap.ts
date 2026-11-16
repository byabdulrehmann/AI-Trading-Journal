import type { MetadataRoute } from "next";

const base = process.env.SITE_URL || "http://localhost:3100";

/** The public marketing pages only. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/home", "/platform", "/features", "/about", "/contact"].map((path) => ({ url: `${base}${path}`, changeFrequency: "monthly", priority: path === "/home" ? 1 : 0.7 }));
}
