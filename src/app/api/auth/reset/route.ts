import { connection } from "next/server";
import { z } from "zod";
import { Credentials, rateLimited, resetWithRecoveryCode, startSession } from "@/lib/server/auth";
import { authenticateLimitKey } from "@/lib/server/client-key";
import { body, fail, json } from "@/lib/server/http";

const Body = z.object({
  email: Credentials.shape.email,
  code: z.string().trim().min(1, "Enter your recovery code").max(64),
  password: Credentials.shape.password,
});

/** Forgotten password: email, recovery code and a new password. Signed out, so it's limited per client and per email. */
export async function POST(req: Request) {
  await connection();
  if (rateLimited(`reset:${authenticateLimitKey()}`)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  if (rateLimited(`reset-email:${data.email}`)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const done = await resetWithRecoveryCode(data.email, data.code, data.password);
  if (!done) return fail("That email and recovery code don't match.", 401);
  await startSession(done.user.id);
  return json({ ok: true, recoveryCode: done.code });
}
