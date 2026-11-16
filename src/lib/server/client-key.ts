import "server-only";
import { headers } from "next/headers";

/**
 * Who is asking, for rate limits. Served on this computer alone there is one client, "local". Behind a reverse proxy
 * (JARVIS_TRUST_PROXY=1) it is the address that proxy saw: the last X-Forwarded-For entry, since anything before it
 * is the caller's own claim. Without the setting the header is ignored, so nobody can pick their own key.
 */
export async function clientKey(): Promise<string> {
  if (process.env.JARVIS_TRUST_PROXY !== "1") return "local";
  return (await headers()).get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";
}
