import { authenticateLimitKey } from "@/lib/server/client-key";
import { createUser, Credentials, issueRecoveryCode, rateLimited, startSession, userCount } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { ensureDefaultAccount } from "@/lib/server/repo/journal";
import { connection } from "next/server";

/** Open to anyone who can reach this computer: each account gets its own private journal. */
export async function POST(req: Request) {
  await connection();
  if (rateLimited(`signup:${authenticateLimitKey()}`)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const data = await body(req, Credentials);
  if (data instanceof Response) return data;
  const firstAccount = userCount() === 0;
  const user = await createUser(data.email, data.password, data.name);
  if (user === "taken") return fail("Couldn't create that account. Try signing in instead.", 409);
  ensureDefaultAccount(user.id);
  const recoveryCode = issueRecoveryCode(user.id);
  await startSession(user.id);
  // The recovery code is in this response only; the page shows it once.
  return json({ user, adoptedExistingData: firstAccount, recoveryCode }, 201);
}
