import { z } from "zod";
import { body, fail, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { getConnection, updateSettings } from "@/lib/server/repo/mt5";
import { syncing } from "@/lib/server/mt5/sync";

const Settings = z.object({
  accountId: z.number().int().positive(),
  intervalSeconds: z.number().int().min(30, "At least 30 seconds").max(86400, "At most a day").optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Settings);
  if (data instanceof Response) return data;
  if (!getConnection(user.id, data.accountId)) return fail("Connection not found.", 404);
  updateSettings(data.accountId, data);
  return json({ connection: getConnection(user.id, data.accountId, syncing) });
}
