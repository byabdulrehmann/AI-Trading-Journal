import { NextResponse, type NextRequest } from "next/server";

// shortcut: loopback hosts only, add an allowed-hosts list and HTTPS before serving Jarvis on a network.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const COOKIE = "jarvis_session"; // Must match auth.ts, which can't be imported here (it opens the database).
// The marketing site and sign-in. Keep in step with PUBLIC_PAGES in src/lib/client/app-state.tsx.
const PUBLIC_PAGES = new Set(["/login", "/welcome", "/platform", "/features", "/about", "/contact"]);
/** Files crawlers and link previews fetch without a session. */
const PUBLIC_FILES = new Set(["/robots.txt", "/sitemap.xml"]);
/** Next adds a content hash to the preview image's path, for example /opengraph-image-p6oktx. */
const isPreviewImage = (path: string) => /^\/opengraph-image(-[a-z0-9]+)?$/.test(path) || /^\/twitter-image(-[a-z0-9]+)?$/.test(path);
/** The site's early-access form is the only API call a signed-out visitor may make, and only to add a request. */
const publicApi = (req: NextRequest) => req.nextUrl.pathname.startsWith("/api/auth/") || (req.nextUrl.pathname === "/api/early-access" && req.method === "POST");

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
  if (req.cookies.has(COOKIE) || PUBLIC_PAGES.has(pathname) || PUBLIC_FILES.has(pathname) || isPreviewImage(pathname) || publicApi(req)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|webp|ico|woff2?)$).*)" };
