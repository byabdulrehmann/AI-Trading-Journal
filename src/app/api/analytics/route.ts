import { breakdown, computeMetrics, drawdownCurve, equityCurve, isClosed, periodSummaries, pnlDistribution, reportingCurrencies } from "@/lib/domain/metrics";
import { detectPatterns } from "@/lib/domain/patterns";
import type { Trade } from "@/lib/domain/types";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { json } from "@/lib/server/http";
import { getAccount, hasSampleData, listAccounts, listTrades } from "@/lib/server/repo/journal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hour = (iso: string) => `${String(new Date(iso).getHours()).padStart(2, "0")}:00`;

function meanR(trades: Trade[], side: (pnl: number) => boolean): number | null {
  const rs = trades.filter(isClosed).filter((t) => side(t.pnl) && t.rMultiple !== null).map((t) => t.rMultiple as number);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

/**
 * Everything the dashboard and analytics pages show, computed here from the database for the
 * given filters. Money never mixes currencies: with no currency chosen it reports in the
 * first one that has trades, and lists the others so the page can offer them.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const filters = filtersFrom(new URL(req.url).searchParams);
  if (filters instanceof Response) return filters;

  const accounts = listAccounts(user.id);
  const unscoped = listTrades(user.id, { ...filters, currency: undefined });
  const { currencies, primary } = reportingCurrencies(accounts, unscoped);
  const accountCurrency = filters.accountId ? getAccount(user.id, filters.accountId)?.currency : undefined;
  const currency = accountCurrency ?? (filters.currency && currencies.includes(filters.currency) ? filters.currency : primary) ?? "USD";
  const ids = new Set(accounts.filter((a) => a.currency === currency).map((a) => a.id));
  const trades = unscoped.filter((t) => ids.has(t.accountId));

  const by = (keyOf: (t: Trade) => string | null) => breakdown(trades, keyOf);
  return json({
    currency,
    currencies,
    sampleHidden: !filters.includeSample && filters.source !== "sample" && !filters.accountId && hasSampleData(user.id),
    metrics: computeMetrics(trades),
    equity: equityCurve(trades),
    drawdown: drawdownCurve(trades),
    periods: { day: periodSummaries(trades, "day"), week: periodSummaries(trades, "week"), month: periodSummaries(trades, "month"), year: periodSummaries(trades, "year") },
    distribution: pnlDistribution(trades),
    breakdowns: {
      symbol: by((t) => t.symbol),
      strategy: by((t) => t.strategy || "(no strategy)"),
      side: by((t) => t.side),
      session: by((t) => t.session ?? "(unknown)"),
      weekday: by((t) => WEEKDAYS[new Date(t.closedAt ?? t.openedAt).getDay()]),
      hour: by((t) => hour(t.openedAt)),
      account: by((t) => accounts.find((a) => a.id === t.accountId)?.name ?? "(unknown)"),
      setup: by((t) => t.setup || "(no setup)"),
      emotion: by((t) => t.emotionBefore ?? "(not recorded)"),
      // "weekday-hour" of the open time, local to this computer, Sunday = 0.
      heatmap: by((t) => `${new Date(t.openedAt).getDay()}-${new Date(t.openedAt).getHours()}`),
    },
    patterns: detectPatterns(trades),
    avgR: { winners: meanR(trades, (p) => p > 0), losers: meanR(trades, (p) => p < 0) },
  });
}
