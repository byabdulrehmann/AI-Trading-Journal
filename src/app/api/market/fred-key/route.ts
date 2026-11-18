import { z } from "zod";
import { rateLimited, requireOwner } from "@/lib/server/auth";
import { FRED_KEY_SHAPE, checkFredKey, hasFredKey, saveFredKey } from "@/lib/server/market/fred";
import { audit } from "@/lib/server/repo/audit";
import { body, fail, json } from "@/lib/server/http";

/** Owner only: whether the install has a FRED key. Never the key itself. */
export async function GET() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  return json({ configured: hasFredKey() });
}

const Save = z.object({ key: z.string().trim().toLowerCase().regex(FRED_KEY_SHAPE, "A FRED key is 32 letters and digits.") });

/** Owner only: saves the install's FRED key, after FRED accepts it. */
export async function PUT(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, Save);
  if (data instanceof Response) return data;
  if (rateLimited(`fred-key:${user.id}`, 10)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const check = await checkFredKey(data.key);
  if (check !== "ok") return fail(check === "rejected" ? "FRED didn't accept that key." : "Couldn't check the key with FRED. Try again in a moment.", 422);
  saveFredKey(data.key);
  audit(user.id, "fred_key.saved");
  return json({ ok: true });
}

/** Owner only: removes the key. Readings already saved stay, and stop updating. */
export async function DELETE() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  saveFredKey(null);
  audit(user.id, "fred_key.removed");
  return json({ ok: true });
}
