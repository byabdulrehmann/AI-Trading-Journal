"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { SESSION_LABELS, duration, money, pct, profitFactorText, rFmt, toneOf } from "@/lib/client/format";
import { journalHref, periodRange } from "@/lib/client/journal-links";
import { useFetch } from "@/lib/client/use-fetch";
import { METRIC_DEFINITIONS as D, type PeriodRow } from "@/lib/domain/metrics";
import { BarChart, BreakdownTable, Heatmap, Histogram, LineChart, MonthlyTable } from "@/components/charts";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, CardHeader, EmptyState, Metric, PageHeader, Segmented, Spinner, cx } from "@/components/ui";

export default function AnalyticsPage() {
  return (
    <Suspended>
      <AnalyticsView />
    </Suspended>
  );
}

const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SIDE: Record<string, string> = { long: "Long", short: "Short" };

const barsOf = (rows: PeriodRow[]) => rows.map((r) => ({ label: r.key, value: r.pnl, detail: `${r.trades} trades, ${r.wins} won, ${r.losses} lost` }));

/** A figure and its label, parted from its neighbour by a hairline. */
function Figure({ label, value, tone, big }: { label: string; value: string; tone?: string; big?: boolean }) {
  return (
    <div className={cx("min-w-0 border-l border-line pl-3 first:border-l-0 first:pl-0", big && "basis-full sm:basis-auto")}>
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={cx("num whitespace-nowrap", big ? "figure" : "text-[17px]", tone ?? "text-ink")}>{value}</dd>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy>
      <Spinner label="Working out your figures" />
      <div className="mt-4 h-72 bg-sunken" aria-hidden />
      <div className="mt-section h-40 bg-sunken" aria-hidden />
    </div>
  );
}

function AnalyticsView() {
  const { editTrade, openTrade, accounts } = useApp();
  const filters = useUrlFilters();
  const router = useRouter();
  const search = useSearchParams().toString();
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);

  if (error && !data) return <EmptyState title="Couldn't load analytics" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Loading />;

  const m = data.metrics;
  const cur = data.currency;
  const period = (PERIODS.some((p) => p.value === filters.get("period")) ? filters.get("period") : "month") as Period;
  const fmt = (n: number) => money(n, cur, true);
  const b = data.breakdowns;

  // Only what the journal can filter on gets a link. It has no side, session, weekday or hour filter yet.
  const toPeriod = (p: Period, key: string) => {
    const range = periodRange(p, key);
    return range && journalHref(search, range);
  };
  const toSymbol = (key: string) => journalHref(search, { symbol: key });
  const toStrategy = (key: string) => (key === "(no strategy)" ? null : journalHref(search, { strategy: key }));
  const toAccount = (key: string) => {
    const same = accounts.filter((a) => a.name === key);
    return same.length === 1 ? journalHref(search, { accountId: String(same[0].id) }) : null;
  };

  return (
    <div className={cx("transition-opacity", loading && "opacity-70")}>
      <PageHeader title="Analytics" description="Every figure comes from your recorded closed trades. Dates filter by open time, results land on the day a trade closed." actions={<CurrencyPicker currency={cur} currencies={data.currencies} filters={filters} />} />
      <TradeFilters filters={filters} source />

      {m.closedTrades === 0 ? (
        filters.active ? (
          <EmptyState title="No closed trades match" body="Widen the date range or clear the filters." action={<Button onClick={filters.clear}>Clear filters</Button>} />
        ) : (
          <EmptyState title="Nothing to analyse yet" body="Analytics use closed trades. Log or import a few, or add exits to open ones." action={<Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>} />
        )
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="lead" className="border-t border-line">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 py-3">
              <div className="min-w-0">
                <h2 id="lead" className="text-[15px] font-medium text-ink">P&amp;L by period</h2>
                <p className="mt-0.5 text-[13px] text-muted">Net in {cur}, by the day trades closed, local time. A bar opens those trades.</p>
              </div>
              <Segmented label="Period" value={period} onChange={(v) => filters.set({ period: v })} options={[...PERIODS]} />
            </div>
            <dl className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-3 sm:gap-x-5">
              <Figure big label="Net P&L" value={fmt(m.netPnl)} tone={toneOf(m.netPnl)} />
              <Figure label="Closed trades" value={String(m.closedTrades)} />
              <Figure label="Won" value={String(m.wins)} />
              <Figure label="Lost" value={String(m.losses)} />
            </dl>
            <BarChart bars={barsOf(data.periods[period])} label={`Net P&L per ${period}`} format={fmt} height={260} summary="Show the numbers" hrefFor={(bar) => toPeriod(period, bar.label)} />
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Strategies" subtitle="A linked name opens its trades in the journal." />
                <BreakdownTable rows={b.strategy} currency={cur} group="Strategy" hrefFor={toStrategy} />
              </Card>
              <Card>
                <CardHeader title="Instruments" />
                <BreakdownTable rows={b.symbol} currency={cur} group="Instrument" hrefFor={toSymbol} />
              </Card>
              <Card>
                <CardHeader title="Long and short" />
                <BreakdownTable rows={b.side} currency={cur} group="Direction" label={(k) => SIDE[k] ?? k} hrefFor={(k) => journalHref(search, { side: k })} />
              </Card>
              <Card>
                <CardHeader title="Sessions" />
                <BreakdownTable rows={b.session} currency={cur} group="Session" label={(k) => SESSION_LABELS[k] ?? k} hrefFor={(k) => (k in SESSION_LABELS ? journalHref(search, { session: k }) : null)} />
              </Card>
              <Card>
                <CardHeader title="Accounts" />
                <BreakdownTable rows={b.account} currency={cur} group="Account" hrefFor={toAccount} />
              </Card>
            </div>

            <Card className="self-start xl:sticky xl:top-20">
              <CardHeader title="Winning and losing trades" subtitle="What a typical result looks like on each side." />
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-muted">
                  <tr className="border-b border-line">
                    <td className="py-1.5" />
                    <th scope="col" className="py-1.5 text-right font-normal">Winners</th>
                    <th scope="col" className="py-1.5 text-right font-normal">Losers</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Trades", m.wins, m.losses],
                    ["Average result", money(m.avgWin, cur, true), money(m.avgLoss, cur, true)],
                    ["Average R", rFmt(data.avgR.winners), rFmt(data.avgR.losers)],
                    ["Median hold", duration(m.holdWinnersMin), duration(m.holdLosersMin)],
                  ].map(([label, w, l]) => (
                    <tr key={label} className="border-b border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">{label}</th>
                      <td className="num py-1.5 text-right text-profit">{w}</td>
                      <td className="num py-1.5 text-right text-loss">{l}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3">
                <Metric def={D.profitFactor} value={profitFactorText(m)} />
                <Metric def={D.expectancy} value={money(m.expectancy, cur, true)} tone={toneOf(m.expectancy)} />
                <Metric def={D.winRate} value={pct(m.winRate, 1)} />
              </dl>
            </Card>
          </div>

          <Card>
            <CardHeader title="When you trade" subtitle="Net P&L by weekday and hour of opening, local time." />
            <Heatmap rows={b.heatmap} currency={cur} onOpen={(day, hour) => router.push(journalHref(search, { weekday: String(day), hour: String(hour) }))} />
          </Card>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Equity curve" subtitle="Cumulative net P&L. Click a point, or focus the chart and press Enter, to open that trade." />
                <LineChart label="Equity curve" points={data.equity.map((p) => ({ at: p.at, value: p.equity, tradeId: p.tradeId }))} currency={cur} onSelect={openTrade} height={240} />
              </Card>
              <Card>
                <CardHeader title="Drawdown" subtitle={`Fall from the running peak. Deepest: ${money(-m.maxDrawdown, cur)}.`} />
                <LineChart label="Drawdown" points={data.drawdown.map((p) => ({ at: p.at, value: p.drawdown }))} currency={cur} tone="loss" height={140} />
              </Card>
            </div>
            <Card className="self-start">
              <CardHeader title="Win and loss distribution" subtitle="Closed trades per P&L bucket." />
              <Histogram buckets={data.distribution} currency={cur} />
            </Card>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-2">
            <Card>
              <CardHeader title="Day of week" subtitle="By the day a trade closed." />
              <BreakdownTable rows={[...b.weekday].sort((x, y) => WEEK.indexOf(x.key) - WEEK.indexOf(y.key))} currency={cur} group="Day" hrefFor={(k) => (WEEKDAYS.includes(k) ? journalHref(search, { weekday: String(WEEKDAYS.indexOf(k)) }) : null)} />
            </Card>
            <Card>
              <CardHeader title="Time of day" subtitle="By the hour a trade opened." />
              <BreakdownTable rows={[...b.hour].sort((x, y) => x.key.localeCompare(y.key))} currency={cur} group="Hour" hrefFor={(k) => journalHref(search, { hour: String(Number(k.slice(0, 2))) })} />
            </Card>
          </div>

          <Card>
            <CardHeader title="Monthly performance" subtitle="Hover a month for its trade count. A month opens the trades opened in it." />
            <MonthlyTable rows={data.periods.month} currency={cur} hrefFor={(key) => toPeriod("month", key)} />
          </Card>

          <p className="text-[12.5px] text-muted">Small groups swing a lot. Treat a group with fewer than about 10 trades as an anecdote.</p>
        </div>
      )}
    </div>
  );
}
