import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { rateLimited, requireUser } from "@/lib/server/auth";
import { isQueued, queueSync } from "@/lib/server/mt5/queue";
import { getConnection } from "@/lib/server/repo/mt5";
import { syncing } from "@/lib/server/mt5/sync";

const Sync = z.object({ accountId: z.number().int().positive() });

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Sync);
  if (data instanceof Response) return data;
  if (!getConnection(user.id, data.accountId)) return fail("Connection not found.", 404);
  // Joining a sync that's already on its way is free; asking for a new one is limited to one a minute per account.
  if (!isQueued(data.accountId) && rateLimited(`mt5-sync:${data.accountId}`, 1, 60_000))
    return fail("This account was synced less than a minute ago. Try again shortly.", 429);
  // Waits its turn: the one terminal syncs one account at a time, taking users in turn.
  const result = await queueSync(data.accountId, user.id);
  if (!result.ok) return fail(result.error, result.category === "busy" ? 409 : 502);
  return json({ connection: getConnection(user.id, data.accountId, syncing) });
}
