import { connection } from "next/server";
import { authenticateLimitKey } from "@/lib/server/client-key";
import { rateLimited, requireOwner } from "@/lib/server/auth";
import { EarlyAccessInput, listEarlyAccess, saveEarlyAccess } from "@/lib/server/early-access";
import { body, fail, json } from "@/lib/server/http";

/** The public website's one write. No session needed; it can't read anything back. */
export async function POST(req: Request) {
  await connection();
  if (Number(req.headers.get("content-length") ?? 0) > 8_000) return fail("That request is too large.", 413);
  // A plain form post (JavaScript off) gets a redirect back to the page with the outcome, never a JSON page.
  const plain = req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded");
  const back = (outcome: "sent" | "error") => Response.redirect(new URL(`/contact?${outcome}=1#early-access`, req.url), 303);
  if (rateLimited(`early-access:${authenticateLimitKey()}`)) return plain ? back("error") : fail("Too many requests. Try again in 15 minutes.", 429);
  if (plain) {
    const parsed = EarlyAccessInput.safeParse(Object.fromEntries((await req.formData()).entries()));
    if (!parsed.success || parsed.data.website) return back("error");
    return back(saveEarlyAccess(parsed.data).ok ? "sent" : "error");
  }
  const data = await body(req, EarlyAccessInput);
  if (data instanceof Response) return data;
  if (data.website) return fail("Some fields need attention.", 422);
  const saved = saveEarlyAccess(data);
  return saved.ok ? json({ ok: true }, 201) : fail(saved.reason, 503);
}

/** Only the owner of this installation reads the requests. */
export async function GET() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  return json({ requests: listEarlyAccess() });
}
