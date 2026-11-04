import { z } from "zod";
import { connection } from "next/server";
import { authenticateLimitKey } from "@/lib/server/client-key";
import { authenticate, clearRateLimit, rateLimited, startSession } from "@/lib/server/auth";
import { audit } from "@/lib/server/repo/audit";
import { body, fail, json } from "@/lib/server/http";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  await connection();
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const key = `login:${authenticateLimitKey(req)}:${data.email}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const user = await authenticate(data.email, data.password);
  if (!user) {
    audit(null, "login.failed");
    return fail("Wrong email or password.", 401);
  }
  clearRateLimit(key);
  await startSession(user.id);
  audit(user.id, "login.succeeded");
  return json({ user });
}
