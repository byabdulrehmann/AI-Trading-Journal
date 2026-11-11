import { z } from "zod";
import { checkPassword, clearRateLimit, hasRecoveryCode, issueRecoveryCode, rateLimited, requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";

/** Whether a recovery code exists. The code itself can never be read again. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ hasCode: hasRecoveryCode(user.id) });
}

const Body = z.object({ current: z.string().max(200) });

/** A new recovery code in place of the old one. Needs the current password, like a password change. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const key = `password:${user.id}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  if (!(await checkPassword(user.id, data.current))) return fail("That isn't your current password.", 401);
  clearRateLimit(key);
  return json({ recoveryCode: issueRecoveryCode(user.id) });
}
