import { z } from "zod";
import { clearRateLimit, Credentials, rateLimited, requireOwner } from "@/lib/server/auth";
import { setBackupPassword } from "@/lib/server/backup";
import { body, fail, json } from "@/lib/server/http";

const Body = z.object({
  next: Credentials.shape.password,
  current: z.string().max(200).optional(),
  // Start over with new keys when the password is lost: older backups stay locked to it.
  reset: z.boolean().default(false),
});

/** Sets or changes the password that encrypts every backup. Owner only. */
export async function PUT(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const key = `backup-password:${user.id}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  if (setBackupPassword(user.id, data.next, { current: data.current, reset: data.reset }) === "wrong") return fail("That isn't the current backup password.", 401);
  clearRateLimit(key);
  return json({ ok: true });
}
