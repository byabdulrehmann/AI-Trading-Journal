import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { clearRateLimit, rateLimited, requireUser } from "@/lib/server/auth";
import { getConnection } from "@/lib/server/repo/mt5";
import { connectAccount, syncing } from "@/lib/server/mt5/sync";

const Connect = z.object({
  login: z.string().trim().regex(/^\d{1,15}$/, "Enter the account number, digits only").transform(Number),
  server: z.string().trim().min(1, "Enter the server name").max(128).regex(/^[\w .-]+$/, "That doesn't look like an MT5 server name"),
  password: z.string().min(1, "Enter the investor password").max(256),
});

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Connect);
  if (data instanceof Response) return data;
  const key = `mt5-connect:${user.id}`;
  if (rateLimited(key)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const result = await connectAccount(user.id, data.login, data.server, data.password);
  if (!result.ok) return json({ error: result.error, category: result.category }, 422);
  clearRateLimit(key);
  return json({ connection: getConnection(user.id, result.accountId, syncing) }, 201);
}
