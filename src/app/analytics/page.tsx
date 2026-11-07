"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { SESSION_LABELS, dateOnly, duration, money, pct, profitFactorText, rFmt, toneOf, zoneName } from "@/lib/client/format";
import { journalHref, periodRange } from "@/lib/client/journal-links";
import { useFetch } from "@/lib/client/use-fetch";
import { HOLD_BUCKETS, METRIC_DEFINITIONS as D, R_BUCKETS, type Bucket, type PeriodRow } from "@/lib/domain/metrics";
import { BarChart, BreakdownTable, Heatmap, Histogram, LineChart, MonthlyTable } from "@/components/charts";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { CompareReport } from "@/components/reports/CompareReport";
import { ExcursionCard } from "@/components/reports/ExcursionCard";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, CardHeader, EmptyState, Metric, PageHeader, Segmented, Spinner, cx } from "@/components/ui";

export default function ReportsPage() {
  return (
    <Suspended>
      <ReportsView />
    </Suspended>
  );
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "time", label: "Day and time" },
  { value: "instruments", label: "Instruments" },
  { value: "playbooks", label: "Playbooks" },
  { value: "behaviour", label: "Behaviour" },
  { value: "risk", label: "Risk" },
  { value: "wins", label: "Wins and losses" },
  { value: "compare", label: "Compare" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SIDE: Record<string, string> = { long: "Long", short: "Short" };
const PLAN: Record<string, string> = { on: "Followed the plan", off: "Off plan" };

const nice = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t[0].toUpperCase() + t.slice(1);
};
const bandPatch = (buckets: Bucket[], key: string, min: string, max: string): Record<string, string> | null => {
  const b = buckets.find((x) => x.key === key);
  return b ? { ...(b.from === undefined ? {} : { [min]: String(b.from) }), ...(b.to === undefined ? {} : { [max]: String(b.to) }) } : null;
};

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

const two = "grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 xl:grid-cols-2";

function ReportsView() {
  const { editTrade, openTrade, accounts } = useApp();
  const filters = useUrlFilters();
  const router = useRouter();
  const search = useSearchParams().toString();
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);

  const tab = (TABS.some((t) => t.value === filters.get("tab")) ? filters.get("tab") : "overview") as Tab;

  if (error && !data) return <EmptyState title="Couldn't load your reports" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Loading />;

  const m = data.metrics;
  const cur = data.display;
  const period = (PERIODS.some((p) => p.value === filters.get("period")) ? filters.get("period") : "month") as Period;
  const fmt = (n: number) => money(n, cur, true);
  const b = data.breakdowns;
  const r = data.report;

  // Only what the journal can filter on gets a link.
  const toPeriod = (p: Period, key: string) => {
    const range = periodRange(p, key);
    return range && journalHref(search, range);
  };
  const toSymbol = (key: string) => journalHref(search, { symbol: key });
  const toStrategy = (key: string) => (key === "(no strategy)" ? null : journalHref(search, { strategy: key }));
  const toBand = (buckets: Bucket[], min: string, max: string) => (key: string) => {
    const p = bandPatch(buckets, key, min, max);
    return p && journalHref(search, p);
  };
  const toAccount = (key: string) => {
    const same = accounts.filter((a) => a.name === key);
    return same.length === 1 ? journalHref(search, { accountId: String(same[0].id) }) : null;
  };
  const toPlan = (key: string) => (key in PLAN ? journalHref(search, { plan: key }) : null);

  const body = () => {
    switch (tab) {
      case "overview":
        return (
          <div className="space-y-8">
            <section aria-labelledby="lead" className="border-t border-line">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 py-3">
                <div className="min-w-0">
                  <h2 id="lead" className="text-[15px] font-medium text-ink">P&amp;L by period</h2>
                  <p className="mt-0.5 text-[13px] text-muted">Net in {cur}, by the day trades closed, {zoneName()}. A bar opens those trades.</p>
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
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Key figures" />
                  <dl>
                    <Metric def={D.profitFactor} value={profitFactorText(m)} />
                    <Metric def={D.expectancy} value={money(m.expectancy, cur, true)} tone={toneOf(m.expectancy)} />
                    <Metric def={D.winRate} value={pct(m.winRate, 1)} />
                    <Metric def={D.payoffRatio} value={m.payoffRatio === null ? "—" : m.payoffRatio.toFixed(2)} />
                    <Metric def={D.recoveryFactor} value={m.recoveryFactor === null ? "—" : m.recoveryFactor.toFixed(2)} />
                  </dl>
                </Card>
                <Card>
                  <CardHeader title="Your days" />
                  <dl>
                    <Metric def={D.dayWinRate} value={`${m.winningDays} of ${m.tradingDays}, ${pct(m.dayWinRate)}`} />
                    <Metric def={D.avgDailyPnl} value={money(m.avgDailyPnl, cur, true)} tone={toneOf(m.avgDailyPnl)} />
                    <Metric def={D.bestDay} value={m.bestDay ? `${money(m.bestDay.pnl, cur, true)}, ${dateOnly(`${m.bestDay.date}T12:00:00Z`)}` : "—"} tone={toneOf(m.bestDay?.pnl)} />
                    <Metric def={D.worstDay} value={m.worstDay ? `${money(m.worstDay.pnl, cur, true)}, ${dateOnly(`${m.worstDay.date}T12:00:00Z`)}` : "—"} tone={toneOf(m.worstDay?.pnl)} />
                  </dl>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader title="Win and loss distribution" subtitle="Closed trades per result bucket." />
              <Histogram buckets={data.distribution} currency={cur} />
            </Card>

            <Card>
              <CardHeader title="Monthly performance" subtitle="Hover a month for its trade count. A month opens the trades opened in it." />
              <MonthlyTable rows={data.periods.month} currency={cur} hrefFor={(key) => toPeriod("month", key)} />
            </Card>
          </div>
        );
      case "time":
        return (
          <div className="space-y-8">
            <Card>
              <CardHeader title="When you trade" subtitle={`Net P&L by weekday and hour of opening, ${zoneName()}.`} />
              <Heatmap rows={b.heatmap} currency={cur} onOpen={(day, hour) => router.push(journalHref(search, { weekday: String(day), hour: String(hour) }))} />
            </Card>
            <div className={two}>
              <Card>
                <CardHeader title="Day of week" subtitle="By the day a trade opened." />
                <BreakdownTable compact rows={[...b.weekday].sort((x, y) => WEEK.indexOf(x.key) - WEEK.indexOf(y.key))} currency={cur} group="Day" hrefFor={(k) => (WEEKDAYS.includes(k) ? journalHref(search, { weekday: String(WEEKDAYS.indexOf(k)) }) : null)} />
              </Card>
              <Card>
                <CardHeader title="Time of day" subtitle="By the hour a trade opened." />
                <BreakdownTable compact rows={[...b.hour].sort((x, y) => x.key.localeCompare(y.key))} currency={cur} group="Hour" hrefFor={(k) => journalHref(search, { hour: String(Number(k.slice(0, 2))) })} />
              </Card>
              <Card>
                <CardHeader title="Sessions" />
                <BreakdownTable compact rows={b.session} currency={cur} group="Session" label={(k) => SESSION_LABELS[k] ?? k} hrefFor={(k) => (k in SESSION_LABELS ? journalHref(search, { session: k }) : null)} />
              </Card>
              <Card>
                <CardHeader title="Month of the year" subtitle="All years together, by the month a trade opened." />
                <BreakdownTable compact rows={[...b.month].sort((x, y) => MONTHS.indexOf(x.key) - MONTHS.indexOf(y.key))} currency={cur} group="Month" />
              </Card>
            </div>
          </div>
        );
      case "instruments":
        return (
          <div className={two}>
            <Card>
              <CardHeader title="Instruments" />
              <BreakdownTable compact rows={b.symbol} currency={cur} group="Instrument" hrefFor={toSymbol} />
            </Card>
            <div className="space-y-8">
              <Card>
                <CardHeader title="Long and short" />
                <BreakdownTable compact rows={b.side} currency={cur} group="Direction" label={(k) => SIDE[k] ?? k} hrefFor={(k) => journalHref(search, { side: k })} />
              </Card>
              <Card>
                <CardHeader title="Asset class" />
                <BreakdownTable compact rows={b.assetClass} currency={cur} group="Asset class" label={nice} hrefFor={(k) => journalHref(search, { assetClass: k })} />
              </Card>
              <Card>
                <CardHeader title="Accounts" />
                <BreakdownTable compact rows={b.account} currency={cur} group="Account" hrefFor={toAccount} />
              </Card>
            </div>
            <Card>
              <CardHeader title="Entry price" subtitle="Average entry, in the instrument's own price." />
              <BreakdownTable compact rows={b.price} currency={cur} group="Price" />
            </Card>
            <Card>
              <CardHeader title="Size" subtitle="Lots, shares or contracts, as recorded." />
              <BreakdownTable compact rows={b.size} currency={cur} group="Size" />
            </Card>
          </div>
        );
      case "playbooks":
        return (
          <div className={two}>
            <Card>
              <CardHeader title="Strategies" subtitle="A linked name opens its trades in the journal." action={<Link href="/playbooks" className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">Open playbooks</Link>} />
              <BreakdownTable compact rows={b.strategy} currency={cur} group="Strategy" hrefFor={toStrategy} />
            </Card>
            <Card>
              <CardHeader title="Setups" />
              <BreakdownTable compact rows={b.setup} currency={cur} group="Setup" />
            </Card>
          </div>
        );
      case "behaviour":
        return (
          <div className={two}>
            <Card>
              <CardHeader title="Mistakes" subtitle="A trade counts once under each mistake marked on it." />
              <BreakdownTable compact rows={b.mistake} currency={cur} group="Mistake" label={nice} empty="No mistakes marked on these closed trades." hrefFor={(k) => journalHref(search, { mistake: k })} />
            </Card>
            <Card>
              <CardHeader title="Tags" subtitle="A trade counts once under each of its tags." />
              <BreakdownTable compact rows={b.tag} currency={cur} group="Tag" empty="No tags on these closed trades." hrefFor={(k) => journalHref(search, { tag: k })} />
            </Card>
            <Card>
              <CardHeader title="Emotion before the trade" />
              <BreakdownTable compact rows={b.emotion} currency={cur} group="Emotion" label={(k) => (k.startsWith("(") ? k : nice(k))} hrefFor={(k) => (k.startsWith("(") ? null : journalHref(search, { emotion: k }))} />
            </Card>
            <Card>
              <CardHeader title="Grade" />
              <BreakdownTable compact rows={b.grade} currency={cur} group="Grade" empty="No grades on these closed trades." hrefFor={(k) => journalHref(search, { grade: k })} />
            </Card>
            <Card>
              <CardHeader title="Following the plan" />
              <BreakdownTable compact rows={b.plan} currency={cur} group="Plan" label={(k) => PLAN[k] ?? "Not answered"} hrefFor={toPlan} />
            </Card>
          </div>
        );
      case "risk":
        return (
          <div className={two}>
            <Card>
              <CardHeader title="Risk taken" subtitle="In money, whatever unit results are shown in." />
              <dl data-testid="risk-report">
                <Metric def={D.stopShare} value={`${r.risk.withStop} of ${data.moneyMetrics.closedTrades}, ${pct(r.risk.stopShare)}`} />
                <Metric def={D.avgRisk} value={money(r.risk.avgRisk, data.currency)} />
                <Metric def={D.avgPlannedR} value={r.risk.avgPlannedR === null ? "—" : `${r.risk.avgPlannedR.toFixed(2)}R`} />
                <Metric def={D.avgR} value={rFmt(r.risk.avgActualR)} tone={toneOf(r.risk.avgActualR)} />
                <Metric def={D.beyondPlan} value={String(r.risk.beyondPlan.count)} note={r.risk.beyondPlan.count ? `Cost ${money(r.risk.beyondPlan.cost, data.currency)} more than the stops allowed for` : undefined} />
                <Metric def={D.maxDrawdown} value={money(-data.moneyMetrics.maxDrawdown, data.currency)} tone={data.moneyMetrics.maxDrawdown ? "text-loss" : undefined} />
              </dl>
            </Card>
            <ExcursionCard stats={r.excursions} unread={r.unread} query={filters.apiQuery({ dates: false })} onDone={reload} />
            <Card>
              <CardHeader title="R multiple" subtitle="Only trades with a stop have an R." />
              <BreakdownTable compact rows={b.rMultiple} currency={cur} group="Result" empty="No closed trade here has a stop." hrefFor={toBand(R_BUCKETS, "rMin", "rMax")} />
            </Card>
            <Card>
              <CardHeader title="Holding time" subtitle="From the first entry to the last exit." />
              <BreakdownTable compact rows={b.hold} currency={cur} group="Held for" hrefFor={toBand(HOLD_BUCKETS, "holdMin", "holdMax")} />
            </Card>
          </div>
        );
      case "wins":
        return (
          <div className={two}>
            <Card>
              <CardHeader title="Winning and losing trades" subtitle="What a typical result looks like on each side." />
              <table className="w-full text-[13.5px]" data-testid="win-loss">
                <thead className="text-left text-[12.5px] text-muted">
                  <tr className="border-b border-line">
                    <td className="py-1.5" />
                    <th scope="col" className="py-1.5 text-right font-normal">Winners</th>
                    <th scope="col" className="py-1.5 text-right font-normal">Losers</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Trades", r.profile.wins.trades, r.profile.losses.trades],
                    ["Total", money(r.profile.wins.total, cur, true), money(r.profile.losses.total, cur, true)],
                    ["Average result", money(r.profile.wins.avg, cur, true), money(r.profile.losses.avg, cur, true)],
                    ["Median result", money(r.profile.wins.median, cur, true), money(r.profile.losses.median, cur, true)],
                    ["Largest", money(r.profile.wins.largest, cur, true), money(r.profile.losses.largest, cur, true)],
                    ["Average R", rFmt(data.avgR.winners), rFmt(data.avgR.losers)],
                    ["Median hold", duration(m.holdWinnersMin), duration(m.holdLosersMin)],
                    ["Average hold", duration(r.profile.wins.avgHoldMin), duration(r.profile.losses.avgHoldMin)],
                  ].map(([label, w, l]) => (
                    <tr key={label} className="border-b border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">{label}</th>
                      <td className="num py-1.5 text-right text-profit">{w}</td>
                      <td className="num py-1.5 text-right text-loss">{l}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHeader title="Streaks" subtitle="Runs in closing order. A breakeven trade ends a run." />
              <dl>
                <Metric def={D.currentStreak} value={m.currentStreak === 0 ? "None" : `${Math.abs(m.currentStreak)} ${m.currentStreak > 0 ? "won" : "lost"}`} tone={toneOf(m.currentStreak)} />
                <Metric def={D.maxConsecutiveWins} value={m.maxConsecutiveWins} />
                <Metric def={D.maxConsecutiveLosses} value={m.maxConsecutiveLosses} />
              </dl>
              <table className="mt-3 w-full text-[13.5px]" data-testid="streaks">
                <thead className="text-left text-[12.5px] text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 font-normal">In a row</th>
                    <th scope="col" className="py-1.5 text-right font-normal">Winning runs</th>
                    <th scope="col" className="py-1.5 text-right font-normal">Losing runs</th>
                  </tr>
                </thead>
                <tbody>
                  {r.streaks.map((s) => (
                    <tr key={s.length} className="border-b border-line">
                      <th scope="row" className="num py-1.5 text-left font-normal text-ink-soft">{s.length}</th>
                      <td className="num py-1.5 text-right">{s.wins || "—"}</td>
                      <td className="num py-1.5 text-right">{s.losses || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHeader title="Costs" subtitle="In money, whatever unit results are shown in." />
              <dl>
                <Metric def={D.totalFees} value={money(data.moneyMetrics.totalFees, data.currency)} />
                <Metric def={D.grossProfit} value={money(data.moneyMetrics.grossProfit, data.currency)} tone="text-profit" />
                <Metric def={D.grossLoss} value={money(data.moneyMetrics.grossLoss, data.currency)} tone={data.moneyMetrics.grossLoss ? "text-loss" : undefined} />
              </dl>
            </Card>
          </div>
        );
      case "compare":
        return <CompareReport filters={filters} currency={data.currency} />;
    }
  };

  return (
    <div className={cx("transition-opacity", loading && "opacity-70")}>
      <PageHeader title="Reports" description="Every figure comes from your recorded closed trades. Dates filter by open time, results land on the day a trade closed." actions={<CurrencyPicker currency={data.currency} currencies={data.currencies} filters={filters} />} />
      <TradeFilters filters={filters} source units unitNote={data.unitNote} />
      <div className="mb-5 overflow-x-auto">
        <Segmented label="Report" value={tab} onChange={(v) => filters.set({ tab: v === "overview" ? null : v })} options={[...TABS]} />
      </div>

      {m.closedTrades === 0 && tab !== "compare" ? (
        filters.active ? (
          <EmptyState title="No closed trades match" body="Widen the date range or clear the filters." action={<Button onClick={filters.clear}>Clear filters</Button>} />
        ) : (
          <EmptyState title="Nothing to analyse yet" body="Reports use closed trades. Log or import a few, or add exits to open ones." action={<Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>} />
        )
      ) : (
        <>
          {body()}
          <p className="mt-8 text-[12.5px] text-muted">Small groups swing a lot. Treat a group with fewer than about 10 trades as an anecdote.</p>
        </>
      )}
    </div>
  );
}
