import { authenticateLimitKey } from "@/lib/server/client-key";
import { createUser, Credentials, rateLimited, startSession, userCount } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { connection } from "next/server";

export async function POST(req: Request) {
  await connection();
  if (rateLimited(`signup:${authenticateLimitKey(req)}`)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const data = await body(req, Credentials);
  if (data instanceof Response) return data;
  const firstAccount = userCount() === 0;
  const user = await createUser(data.email, data.password, data.name);
  if (user === "taken") return fail("Couldn't create that account. Try signing in instead.", 409);
  await startSession(user.id);
  return json({ user, adoptedExistingData: firstAccount }, 201);
}
