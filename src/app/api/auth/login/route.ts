import { z } from "zod";
import { connection } from "next/server";
import { clientKey } from "@/lib/server/client-key";
import { authenticate, clearRateLimit, emailTag, rateCount, rateLimited, startSession } from "@/lib/server/auth";
import { audit } from "@/lib/server/repo/audit";
import { body, fail, json } from "@/lib/server/http";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  await connection();
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const client = await clientKey();
  const key = `login:${client}:${data.email}`;
  // Per address and email, and a wider ceiling on failures per address, so trying many emails is limited too.
  const failures = `login-failed:${client}`;
  if (rateLimited(key) || rateCount(failures) >= 30) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const user = await authenticate(data.email, data.password);
  if (!user) {
    rateLimited(failures, 30);
    audit(null, "login.failed", undefined, undefined, { email: emailTag(data.email) });
    return fail("Wrong email or password.", 401);
  }
  clearRateLimit(key);
  await startSession(user.id);
  audit(user.id, "login.succeeded");
  return json({ user });
}
