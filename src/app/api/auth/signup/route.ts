import { authenticateLimitKey } from "@/lib/server/client-key";
import { createUser, Credentials, rateLimited, startSession, userCount } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { ensureDefaultAccount } from "@/lib/server/repo/journal";
import { connection } from "next/server";

export async function POST(req: Request) {
  await connection();
  if (rateLimited(`signup:${authenticateLimitKey()}`)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  if (userCount() > 0 && process.env.JARVIS_OPEN_SIGNUP !== "1") return fail("Sign-up is closed on this computer. Sign in instead.", 403);
  const data = await body(req, Credentials);
  if (data instanceof Response) return data;
  const firstAccount = userCount() === 0;
  const user = await createUser(data.email, data.password, data.name);
  if (user === "taken") return fail("Couldn't create that account. Try signing in instead.", 409);
  ensureDefaultAccount(user.id);
  await startSession(user.id);
  return json({ user, adoptedExistingData: firstAccount }, 201);
}
