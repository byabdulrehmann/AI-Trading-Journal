import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, json } from "@/lib/server/http";
import { recordActivity } from "@/lib/server/repo/activity";
import { bulkUpdateTrades } from "@/lib/server/repo/journal";

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setStrategy"), name: z.string().trim().min(1, "Name the strategy").max(60) }),
  z.object({ type: z.literal("clearStrategy") }),
  z.object({ type: z.literal("addTag"), name: z.string().trim().min(1, "Name the tag").max(30) }),
  z.object({ type: z.literal("removeTag"), name: z.string().trim().min(1, "Name the tag").max(30) }),
  z.object({ type: z.literal("moveAccount"), accountId: z.number().int().positive() }),
]);
const Body = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500), action: Action });

/** One change across selected trades. Trades it can't apply to are skipped and counted, and the rest still change. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const result = bulkUpdateTrades(user.id, data.ids, data.action);
  recordActivity(user.id, "trade.updated", { tradeIds: data.ids, bulk: data.action.type });
  return json(result);
}
