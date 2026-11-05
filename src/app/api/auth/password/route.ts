import { z } from "zod";
import { changePassword, clearRateLimit, Credentials, rateLimited, requireUser, startSession } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";

const Body = z.object({ current: z.string().max(200), next: Credentials.shape.password });

/** Changes the password and signs out every other device. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const key = `password:${user.id}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  if (!(await changePassword(user.id, data.current, data.next))) return fail("That isn't your current password.", 401);
  clearRateLimit(key);
  await startSession(user.id);
  return json({ ok: true });
}
