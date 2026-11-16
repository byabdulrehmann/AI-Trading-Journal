import { connection } from "next/server";
import { authenticateLimitKey } from "@/lib/server/client-key";
import { rateLimited, requireOwner } from "@/lib/server/auth";
import { EarlyAccessInput, listEarlyAccess, saveEarlyAccess } from "@/lib/server/early-access";
import { body, fail, json } from "@/lib/server/http";

const MAX_BYTES = 8_000;

/** The body, read until MAX_BYTES and no further; null when it is bigger. Doesn't trust content-length. */
async function readCapped(req: Request): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader!.read()) {
    size += r.value.length;
    if (size > MAX_BYTES) {
      await reader!.cancel();
      return null;
    }
    chunks.push(r.value);
  }
  return Buffer.concat(chunks);
}

/** The public website's one write. No session needed; it can't read anything back. */
export async function POST(incoming: Request) {
  await connection();
  const bytes = await readCapped(incoming);
  if (!bytes) return fail("That request is too large.", 413);
  // The same request again, now holding only the bytes already read.
  const req = new Request(incoming.url, { method: "POST", headers: incoming.headers, body: new Uint8Array(bytes) });
  // A plain form post (JavaScript off) gets a redirect back to the page with the outcome, never a JSON page.
  const plain = req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded");
  const back = (outcome: "sent" | "error") => Response.redirect(new URL(`/contact/early-access?${outcome}=1`, req.url), 303);
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
