import { NextResponse, type NextRequest } from "next/server";

// shortcut: loopback hosts only, add a login and an allowed-hosts list before serving Kestrel on a network.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // e.g. "null" from a sandboxed page
  }
}

/**
 * The API has no login and can reach TradBot-I, so it answers only this computer.
 * The Host check stops DNS rebinding; the rest stops other sites sending changes,
 * which browsers allow without CORS when the body is labelled text/plain.
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return NextResponse.json({ error: "Kestrel only answers on this computer." }, { status: 403 });

  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    if ((origin && !sameHost(origin, host)) || site === "cross-site" || site === "same-site")
      return NextResponse.json({ error: "Requests from other sites aren't allowed." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
