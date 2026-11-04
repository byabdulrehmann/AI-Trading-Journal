import "server-only";

/** The server only listens on loopback, so there's one client address; this leaves room for more. */
export function authenticateLimitKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}
