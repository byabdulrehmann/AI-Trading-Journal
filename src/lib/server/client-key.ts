import "server-only";

/** The server only listens on loopback, so there's one client. A forwarded header would be the caller's own claim. */
export const authenticateLimitKey = () => "local";
