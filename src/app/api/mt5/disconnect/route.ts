import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getConnection } from "@/lib/server/repo/mt5";
import { disconnectAccount, syncing } from "@/lib/server/mt5/sync";

const Disconnect = z.object({ accountId: z.number().int().positive() });

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Disconnect);
  if (data instanceof Response) return data;
  if (!getConnection(user.id, data.accountId)) return fail("Connection not found.", 404);
  await disconnectAccount(user.id, data.accountId);
  return json({ connection: getConnection(user.id, data.accountId, syncing) });
}
