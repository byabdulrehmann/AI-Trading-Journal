import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getConnection } from "@/lib/server/repo/mt5";
import { syncAccount, syncing } from "@/lib/server/mt5/sync";

const Sync = z.object({ accountId: z.number().int().positive() });

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Sync);
  if (data instanceof Response) return data;
  if (!getConnection(user.id, data.accountId)) return fail("Connection not found.", 404);
  const result = await syncAccount(data.accountId);
  if (!result.ok) return fail(result.error, result.category === "busy" ? 409 : 502);
  return json({ connection: getConnection(user.id, data.accountId, syncing) });
}
