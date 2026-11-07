import { z } from "zod";
import { TradeInput } from "@/lib/domain/types";
import { body, fail, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { createTrade, getAccount, listTradesPage, type TradeSort } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";
import { filtersFrom } from "@/lib/server/filters";

const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["openedAt", "closedAt", "pnl", "rMultiple", "symbol", "quantity", "hold"]).default("openedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

/** One page of trades. Filters are in the query string: see filtersFrom. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const q = Query.safeParse(Object.fromEntries(params));
  if (!q.success) return fail("Invalid paging or sort options.", 400);
  const filters = filtersFrom(params);
  if (filters instanceof Response) return filters;
  const { trades, total } = listTradesPage(user.id, filters, q.data.sort as TradeSort, q.data.dir, q.data.page, q.data.pageSize);
  return json({ trades, total, page: q.data.page, pageSize: q.data.pageSize });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, TradeInput);
  if (data instanceof Response) return data;
  const account = getAccount(user.id, data.accountId);
  if (!account) return fail("That account doesn't exist.", 422);
  if (account.source === "backtest") return fail("Backtest trades come from their session, and stay in it.", 422);
  const trade = createTrade(user.id, data);
  recordActivity(user.id, "trade.created", { tradeId: trade.id, symbol: trade.symbol });
  return json({ trade }, 201);
}
