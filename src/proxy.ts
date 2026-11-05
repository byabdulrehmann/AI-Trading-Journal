import { NextResponse, type NextRequest } from "next/server";

// shortcut: loopback hosts only, add an allowed-hosts list and HTTPS before serving Jarvis on a network.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const COOKIE = "jarvis_session"; // Must match auth.ts, which can't be imported here (it opens the database).
const PUBLIC_PAGES = new Set(["/login", "/welcome"]);

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // e.g. "null" from a sandboxed page
  }
}

/**
 * First line of defence, in front of every page and route.
 * The Host check stops DNS rebinding. The origin check stops other sites sending changes,
 * which browsers allow without CORS when the body is labelled text/plain.
 * A missing cookie is turned away here, but whether a session is valid is decided by
 * requireUser in each route, which is the actual access control.
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return NextResponse.json({ error: "Jarvis only answers on this computer." }, { status: 403 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    if ((origin && !sameHost(origin, host)) || site === "cross-site" || site === "same-site")
      return NextResponse.json({ error: "Requests from other sites aren't allowed." }, { status: 403 });
  }

  const { pathname } = req.nextUrl;
  if (req.cookies.has(COOKIE) || PUBLIC_PAGES.has(pathname) || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|webp|ico|woff2?)$).*)" };
