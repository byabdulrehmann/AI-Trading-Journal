import { z } from "zod";
import { body, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { setTradesDeleted } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), deleted: z.boolean() });

/** Soft delete (deleted: true) or undo (deleted: false). */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const changed = setTradesDeleted(user.id, data.ids, data.deleted);
  recordActivity(user.id, "trade.deleted", { tradeIds: data.ids, restored: !data.deleted });
  return json({ changed });
}
