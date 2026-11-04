import { z } from "zod";
import { body, dynamic, json } from "@/lib/server/http";
import { setTradesDeleted } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), deleted: z.boolean() });

/** Soft delete (deleted: true) or undo (deleted: false). */
export async function POST(req: Request) {
  await dynamic();
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const changed = setTradesDeleted(data.ids, data.deleted);
  recordActivity("trade.deleted", { tradeIds: data.ids, restored: !data.deleted });
  return json({ changed });
}
