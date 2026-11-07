import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { getTrade } from "@/lib/server/repo/journal";
import { tradeBars } from "@/lib/server/tradeBars";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const trade = id ? getTrade(user.id, id) : null;
  if (!trade) return fail("Trade not found.", 404);
  return json({ ...(await tradeBars(user.id, trade)), trade: { id: trade.id, symbol: trade.symbol, side: trade.side, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, stopPrice: trade.stopPrice, targetPrice: trade.targetPrice, mae: getTrade(user.id, trade.id)?.mae ?? null, mfe: getTrade(user.id, trade.id)?.mfe ?? null, quantity: trade.quantity, multiplier: trade.multiplier, fxRate: trade.fxRate, grossPnl: trade.grossPnl, accountId: trade.accountId } });
}
