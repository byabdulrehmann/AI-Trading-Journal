import { NextResponse, type NextRequest } from "next/server";
import { isSitePath, sectionPath } from "@/lib/site-paths";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** Names Jarvis also answers to when served on a network, from JARVIS_ALLOWED_HOSTS ("jarvis.example.com,10.0.0.5:3100"). */
const EXTRA_HOSTS = new Set((process.env.JARVIS_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
const allowedHost = (host: string) => LOCAL_HOST.test(host) || EXTRA_HOSTS.has(host.toLowerCase()) || EXTRA_HOSTS.has(host.toLowerCase().replace(/:\d+$/, ""));
/** Behind HTTPS (JARVIS_HTTPS=1), browsers are told to use nothing else for a year. */
const HSTS = process.env.JARVIS_HTTPS === "1" ? "max-age=31536000" : null;
const isDev = process.env.NODE_ENV !== "production";

/** Only scripts carrying this request's nonce run, and what they load ('strict-dynamic'). Nothing from other sites. */
const policy = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React writes style attributes, which a nonce can't cover; a style can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
const COOKIE = "jarvis_session"; // Must match auth.ts, which can't be imported here (it opens the database).
// The marketing site and sign-in. Keep in step with PUBLIC_PAGES in src/lib/client/app-state.tsx.
const PUBLIC_PAGES = new Set(["/login", "/signup", "/forgot-password", "/home", "/platform", "/features", "/about", "/contact"]);
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
  const nonce = btoa(crypto.randomUUID());
  const csp = policy(nonce);
  const finish = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    if (HSTS) res.headers.set("Strict-Transport-Security", HSTS);
    return res;
  };
  // Next reads the nonce from the request's policy and puts it on its own scripts; the layout reads x-nonce for ours.
  const forward = () => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return { request: { headers } };
  };

  const host = req.headers.get("host") ?? "";
  if (!allowedHost(host)) return finish(NextResponse.json({ error: "Jarvis doesn't answer to that address." }, { status: 403 }));

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    if ((origin && !sameHost(origin, host)) || site === "cross-site" || site === "same-site")
      return finish(NextResponse.json({ error: "Requests from other sites aren't allowed." }, { status: 403 }));
  }

  const { pathname } = req.nextUrl;
  // A site section's own path (/home/mt5) is the page's HTML; the page scrolls to the section.
  const section = sectionPath(pathname);
  if (section) return finish(NextResponse.rewrite(new URL(section.page + req.nextUrl.search, req.url), forward()));
  if (req.cookies.has(COOKIE) || PUBLIC_PAGES.has(pathname) || isSitePath(pathname) || PUBLIC_FILES.has(pathname) || isPreviewImage(pathname) || publicApi(req)) return finish(NextResponse.next(forward()));
  if (pathname.startsWith("/api/")) return finish(NextResponse.json({ error: "Please sign in." }, { status: 401 }));
  return finish(NextResponse.redirect(new URL("/login", req.url)));
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|webp|ico|woff2?)$).*)" };
