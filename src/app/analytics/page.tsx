"use client";

import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { SESSION_LABELS, duration, money, pct, profitFactorText, rFmt, toneOf } from "@/lib/client/format";
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
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SIDE: Record<string, string> = { long: "Long", short: "Short" };

const barsOf = (rows: PeriodRow[]) => rows.map((r) => ({ label: r.key, value: r.pnl, detail: `${r.trades} trades, ${r.wins} won, ${r.losses} lost` }));

function AnalyticsView() {
  const { editTrade, openTrade } = useApp();
  const filters = useUrlFilters();
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);

  if (error && !data) return <EmptyState title="Couldn't load analytics" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Working out your figures" />;

  const m = data.metrics;
  const cur = data.currency;
  const period = (PERIODS.some((p) => p.value === filters.get("period")) ? filters.get("period") : "month") as Period;
  const fmt = (n: number) => money(n, cur, true);
  const b = data.breakdowns;

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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader
              title="P&L by period"
              subtitle={`Net in ${cur}, by the day trades closed, local time.`}
              action={<Segmented label="Period" value={period} onChange={(v) => filters.set({ period: v })} options={[...PERIODS]} />}
            />
            <div className="p-card"><BarChart bars={barsOf(data.periods[period])} label={`Net P&L per ${period}`} format={fmt} summary="Show the numbers" /></div>
          </Card>

          <Card>
            <CardHeader title="Equity curve" subtitle="Cumulative net P&L. Click to open a trade." />
            <div className="p-card"><LineChart label="Equity curve" points={data.equity.map((p) => ({ at: p.at, value: p.equity, tradeId: p.tradeId }))} currency={cur} onSelect={openTrade} /></div>
          </Card>
          <Card>
            <CardHeader title="Drawdown" subtitle={`Fall from the running peak. Deepest: ${money(-m.maxDrawdown, cur)}.`} />
            <div className="p-card"><LineChart label="Drawdown" points={data.drawdown.map((p) => ({ at: p.at, value: p.drawdown }))} currency={cur} tone="loss" /></div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Monthly performance" subtitle="Hover a month for its trade count." />
            <div className="p-card"><MonthlyTable rows={data.periods.month} currency={cur} /></div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="When you trade" subtitle="Net P&L by weekday and hour of opening, local time." />
            <div className="p-card"><Heatmap rows={b.heatmap} currency={cur} /></div>
          </Card>

          <Card>
            <CardHeader title="Win and loss distribution" subtitle="Closed trades per P&L bucket." />
            <div className="p-card"><Histogram buckets={data.distribution} currency={cur} /></div>
          </Card>
          <Card>
            <CardHeader title="Winning and losing trades" subtitle="What a typical result looks like on each side." />
            <div className="overflow-x-auto p-card">
              <table className="w-full text-[13.5px]">
                <thead className="text-left text-[12.5px] text-muted">
                  <tr>
                    <td className="py-1.5" />
                    <th scope="col" className="py-1.5 text-right font-normal">Winners</th>
                    <th scope="col" className="py-1.5 text-right font-normal">Losers</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {[
                    ["Trades", m.wins, m.losses],
                    ["Average result", money(m.avgWin, cur, true), money(m.avgLoss, cur, true)],
                    ["Average R", rFmt(data.avgR.winners), rFmt(data.avgR.losers)],
                    ["Median hold", duration(m.holdWinnersMin), duration(m.holdLosersMin)],
                  ].map(([label, w, l]) => (
                    <tr key={label} className="border-t border-line">
                      <th scope="row" className="py-1.5 text-left font-sans font-normal text-ink-soft">{label}</th>
                      <td className="py-1.5 text-right text-profit">{w}</td>
                      <td className="py-1.5 text-right text-loss">{l}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3">
                <Metric def={D.profitFactor} value={profitFactorText(m)} />
                <Metric def={D.expectancy} value={money(m.expectancy, cur, true)} tone={toneOf(m.expectancy)} />
                <Metric def={D.winRate} value={pct(m.winRate, 1)} />
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Strategies" />
            <div className="p-card"><BreakdownTable rows={b.strategy} currency={cur} group="Strategy" /></div>
          </Card>
          <Card>
            <CardHeader title="Instruments" />
            <div className="p-card"><BreakdownTable rows={b.symbol} currency={cur} group="Instrument" /></div>
          </Card>
          <Card>
            <CardHeader title="Long and short" />
            <div className="p-card"><BreakdownTable rows={b.side} currency={cur} group="Direction" label={(k) => SIDE[k] ?? k} /></div>
          </Card>
          <Card>
            <CardHeader title="Sessions" />
            <div className="p-card"><BreakdownTable rows={b.session} currency={cur} group="Session" label={(k) => SESSION_LABELS[k] ?? k} /></div>
          </Card>
          <Card>
            <CardHeader title="Day of week" subtitle="By the day a trade closed." />
            <div className="p-card"><BreakdownTable rows={[...b.weekday].sort((x, y) => WEEK.indexOf(x.key) - WEEK.indexOf(y.key))} currency={cur} group="Day" /></div>
          </Card>
          <Card>
            <CardHeader title="Time of day" subtitle="By the hour a trade opened." />
            <div className="p-card"><BreakdownTable rows={[...b.hour].sort((x, y) => x.key.localeCompare(y.key))} currency={cur} group="Hour" /></div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Accounts" />
            <div className="p-card"><BreakdownTable rows={b.account} currency={cur} group="Account" /></div>
          </Card>
          <p className="text-[12.5px] text-muted lg:col-span-2">Small groups swing a lot. Treat a group with fewer than about 10 trades as an anecdote.</p>
        </div>
      )}
    </div>
  );
}
