import { TradeInput } from "@/lib/domain/types";
import { body, fail, idParam, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { duplicateTrade, getAccount, getTrade, updateTrade } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET(_req: Request, ctx: RouteContext<"/api/trades/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  const trade = id ? getTrade(user.id, id) : null;
  return trade ? json({ trade }) : fail("Trade not found.", 404);
}

export async function PUT(req: Request, ctx: RouteContext<"/api/trades/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id) return fail("Invalid trade id.", 404);
  const before = getTrade(user.id, id);
  if (!before) return fail("Trade not found.", 404);
  const data = await body(req, TradeInput);
  if (data instanceof Response) return data;
  const account = getAccount(user.id, data.accountId);
  if (!account) return fail("That account doesn't exist.", 422);
  if (data.accountId !== before.accountId && (before.source === "backtest" || account.source === "backtest")) return fail("Backtest trades come from their session, and stay in it.", 422);
  const trade = updateTrade(user.id, id, data);
  const changed = Object.keys(data).filter(
    (k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]),
  );
  recordActivity(user.id, "trade.updated", { tradeId: id, fields: changed });
  return json({ trade });
}

/** Duplicates the trade as a new manual entry. */
export async function POST(_req: Request, ctx: RouteContext<"/api/trades/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (id && getTrade(user.id, id)?.source === "backtest") return fail("Backtest trades come from their session, and stay in it.", 422);
  const trade = id ? duplicateTrade(user.id, id) : null;
  return trade ? json({ trade }, 201) : fail("Trade not found.", 404);
}
