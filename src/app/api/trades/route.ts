import { TradeInput } from "@/lib/domain/types";
import { body, dynamic, fail, json } from "@/lib/server/http";
import { createTrade, ensureDefaultAccount, getAccount, listAccounts, listTrades } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET() {
  await dynamic();
  ensureDefaultAccount();
  return json({ trades: listTrades(), accounts: listAccounts() });
}

export async function POST(req: Request) {
  await dynamic();
  const data = await body(req, TradeInput);
  if (data instanceof Response) return data;
  if (!getAccount(data.accountId)) return fail("That account doesn't exist.", 422);
  const trade = createTrade(data);
  recordActivity("trade.created", { tradeId: trade.id, symbol: trade.symbol });
  return json({ trade }, 201);
}
