import { DailyInput } from "@/lib/domain/types";
import { zoneInstant } from "@/lib/domain/zone";
import { requireUser } from "@/lib/server/auth";
import { fail, json } from "@/lib/server/http";
import { getTrade, listTrades } from "@/lib/server/repo/journal";
import { getSettings } from "@/lib/server/repo/settings";
import { dayBars } from "@/lib/server/tradeBars";

/** A day's trades in one instrument, with prices for replaying them. Trades opened that day, in the chosen zone. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const parsed = DailyInput.shape.date.safeParse(params.get("date"));
  if (!parsed.success) return fail("Invalid date.", 400);
  const tz = getSettings(user.id).timeZone || undefined;
  const [y, m, d] = parsed.data.split("-").map(Number);
  const from = new Date(zoneInstant(y, m, d, 0, 0, tz)).toISOString();
  const to = new Date(zoneInstant(y, m, d + 1, 0, 0, tz) - 1).toISOString();
  const list = listTrades(user.id, { from, to, includeSample: params.get("includeSample") === "1" });
  const symbols = [...new Set(list.map((t) => t.symbol))].sort();
  if (symbols.length === 0) return json({ symbols, symbol: null, source: null, reason: "No trades opened on this day.", timeframe: "M1", bars: [], markers: [], positions: [], trades: [] });
  const asked = params.get("symbol");
  const symbol = asked && symbols.includes(asked) ? asked : symbols[0];
  const full = list.filter((t) => t.symbol === symbol).map((t) => getTrade(user.id, t.id)).filter((t) => t !== null);
  return json({ symbols, symbol, ...(await dayBars(user.id, full, symbol)), trades: full.map((t) => ({ id: t.id, side: t.side, grossPnl: t.grossPnl })) });
}
