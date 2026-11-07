import { HOLD_BUCKETS, PRICE_BUCKETS, R_BUCKETS, SIZE_BUCKETS, UNITS, breakdown, breakdownMany, bucketBreakdown, computeMetrics, computeScore, drawdownCurve, riskReport, streakRuns, winLossProfile, equityCurve, holdMinutes, isClosed, periodSummaries, pnlDistribution, tradesInUnit, type Unit } from "@/lib/domain/metrics";
import { detectPatterns } from "@/lib/domain/patterns";
import type { Account, Trade } from "@/lib/domain/types";
import { zoneParts } from "@/lib/domain/zone";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { json } from "@/lib/server/http";
import { hasSampleData, listInstruments } from "@/lib/server/repo/journal";
import { getSettings } from "@/lib/server/repo/settings";
import { currencyScope } from "@/lib/server/scope";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function meanR(trades: Trade[], side: (pnl: number) => boolean): number | null {
  const rs = trades.filter(isClosed).filter((t) => side(t.pnl) && t.rMultiple !== null).map((t) => t.rMultiple as number);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UNIT_CODE: Record<Exclude<Unit, "money">, string> = { percent: "%", r: "R", pips: "pips" };
const LEFT_OUT: Record<Exclude<Unit, "money">, string> = {
  percent: "their account has no starting balance",
  r: "they have no stop",
  pips: "pips only apply to forex, and to metals when the broker's digits are known",
};

/** Falls back to money, and says so, when nothing can be shown in the unit asked for. */
function restate(userId: number, trades: Trade[], unit: Unit, accounts: Account[]): { unit: Unit; trades: Trade[]; note: string | null } {
  if (unit === "money") return { unit, trades, note: null };
  const balances = new Map(accounts.map((a) => [a.id, a.startingBalance]));
  const specs = new Map(unit === "pips" ? [...new Set(trades.map((t) => t.accountId))].flatMap((id) => listInstruments(userId, id).map((s) => [`${id}:${s.symbol}`, s.digits] as const)) : []);
  const r = tradesInUnit(trades, unit, { balances, digits: (t) => specs.get(`${t.accountId}:${t.symbol}`) ?? null });
  const closed = r.trades.filter(isClosed).length;
  if (r.left > 0 && closed === 0) return { unit: "money", trades, note: `Showing money, because no closed trade here can be shown that way: ${LEFT_OUT[unit]}.` };
  const base = unit === "percent" && closed ? `Percent of the ${r.base.toLocaleString("en-US")} combined starting balance. ` : "";
  return { unit, trades: r.trades, note: r.left ? `${base}${r.left} closed ${r.left === 1 ? "trade is" : "trades are"} left out: ${LEFT_OUT[unit]}.` : base.trim() || null };
}

/**
 * Everything the dashboard and analytics pages show, computed here from the database for the given filters.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const filters = filtersFrom(new URL(req.url).searchParams);
  if (filters instanceof Response) return filters;

  const { accounts, currency, currencies, trades: real } = currencyScope(user.id, filters);

  const tz = getSettings(user.id).timeZone || undefined;
  const moneyMetrics = computeMetrics(real, tz);
  const asked = new URL(req.url).searchParams.get("unit") as Unit | null;
  const shown = restate(user.id, real, asked && UNITS.includes(asked) ? asked : "money", accounts);
  const trades = shown.trades;
  const opened = (t: Trade) => zoneParts(Date.parse(t.openedAt), tz);
  const by = (keyOf: (t: Trade) => string | null) => breakdown(trades, keyOf);
  return json({
    currency,
    currencies,
    unit: shown.unit,
    display: shown.unit === "money" ? currency : UNIT_CODE[shown.unit],
    unitNote: shown.note,
    moneyMetrics,
    score: computeScore(moneyMetrics),
    sampleHidden: !filters.includeSample && filters.source !== "sample" && !filters.accountId && hasSampleData(user.id),
    metrics: shown.unit === "money" ? moneyMetrics : computeMetrics(trades, tz),
    equity: equityCurve(trades),
    drawdown: drawdownCurve(trades),
    periods: { day: periodSummaries(trades, "day", tz), week: periodSummaries(trades, "week", tz), month: periodSummaries(trades, "month", tz), year: periodSummaries(trades, "year", tz) },
    distribution: pnlDistribution(trades),
    breakdowns: {
      symbol: by((t) => t.symbol),
      strategy: by((t) => t.strategy || "(no strategy)"),
      side: by((t) => t.side),
      session: by((t) => t.session ?? "(unknown)"),
      weekday: by((t) => WEEKDAYS[opened(t).weekday]),
      hour: by((t) => `${String(opened(t).hour).padStart(2, "0")}:00`),
      account: by((t) => accounts.find((a) => a.id === t.accountId)?.name ?? "(unknown)"),
      setup: by((t) => t.setup || "(no setup)"),
      emotion: by((t) => t.emotionBefore ?? "(not recorded)"),
      month: by((t) => MONTHS[opened(t).month - 1]),
      plan: by((t) => (t.followedPlan === null ? "unanswered" : t.followedPlan ? "on" : "off")),
      assetClass: by((t) => t.assetClass),
      grade: by((t) => t.grade),
      tag: breakdownMany(trades, (t) => [...t.tags, ...t.strategyTags]),
      mistake: breakdownMany(trades, (t) => t.mistakes),
      hold: bucketBreakdown(trades, holdMinutes, HOLD_BUCKETS),
      rMultiple: bucketBreakdown(trades, (t) => t.rMultiple, R_BUCKETS),
      price: bucketBreakdown(trades, (t) => t.entryPrice, PRICE_BUCKETS),
      size: bucketBreakdown(trades, (t) => t.quantity, SIZE_BUCKETS),
      // "weekday-hour" of the open time, in the chosen zone, Sunday = 0.
      heatmap: by((t) => `${opened(t).weekday}-${opened(t).hour}`),
    },
    patterns: detectPatterns(real, tz),
    report: { profile: winLossProfile(trades), streaks: streakRuns(trades), risk: riskReport(real) },
    avgR: { winners: meanR(real, (p) => p > 0), losers: meanR(real, (p) => p < 0) },
  });
}
