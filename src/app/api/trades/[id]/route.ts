import { TradeInput } from "@/lib/domain/types";
import { body, dynamic, fail, idParam, json } from "@/lib/server/http";
import { getAccount, getTrade, updateTrade } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function PUT(req: Request, ctx: RouteContext<"/api/trades/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid trade id.", 404);
  const before = getTrade(id);
  if (!before) return fail("Trade not found.", 404);
  const data = await body(req, TradeInput);
  if (data instanceof Response) return data;
  if (!getAccount(data.accountId)) return fail("That account doesn't exist.", 422);
  const trade = updateTrade(id, data);
  const changed = Object.keys(data).filter(
    (k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]),
  );
  recordActivity("trade.updated", { tradeId: id, fields: changed });
  return json({ trade });
}
