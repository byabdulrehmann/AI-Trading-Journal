"use client";

import Link from "next/link";
import { useState } from "react";
import type { Analytics } from "@/lib/client/analytics";
import { dayKey, fromKey, monthKeyOf, weeksOf } from "@/lib/client/calendar";
import { compactMoney, dateTime, duration, money, pct, profitFactorText, rFmt, toneOf, zoneName } from "@/lib/client/format";
import { journalHref, periodRange } from "@/lib/client/journal-links";
import type { WidgetId } from "@/lib/domain/dashboard";
import { METRIC_DEFINITIONS as D, type PeriodRow } from "@/lib/domain/metrics";
import type { PatternFinding } from "@/lib/domain/patterns";
import type { Account, Trade } from "@/lib/domain/types";
import { BarChart, BreakdownTable, Histogram, LineChart, RadarChart } from "@/components/charts";
import { PnlIssue, SideBadge, SourceBadge } from "@/components/journal/badges";
import { Tape } from "@/components/tape/Tape";
import { Button, Card, CardHeader, Metric, cx } from "@/components/ui";

export interface WidgetContext {
  data: Analytics;
  /** What results are shown in: a currency, or %, R or pips. */
  display: string;
  search: string;
  accounts: Account[];
  recent: Trade[];
  patterns: PatternFinding[];
  toAnswer: number;
  coachEnabled: boolean;
  symbols: Map<number, string>;
  rangeActive: boolean;
  openTrade: (id: number) => void;
  askJarvis: (prompt: string) => void;
  brush: (from: string, to: string) => void;
  clearRange: () => void;
}

const DAILY_BARS = 30;
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const nice = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t[0].toUpperCase() + t.slice(1);
};

function Ledger({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="py-2.5 text-[15px] font-medium text-ink">{title}</h2>
      <dl>{children}</dl>
    </Card>
  );
}

function Score({ data }: WidgetContext) {
  const s = data.score;
  return (
    <Card>
      <CardHeader title="Score" subtitle="Jarvis's own 0 to 100 measure of how you trade. It describes these trades and predicts nothing." />
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <RadarChart axes={s.axes.map((a) => ({ label: a.label, value: a.value }))} label={s.score === null ? "Score axes, not enough trades for a total" : `Score ${s.score} of 100`} />
        <div className="min-w-0">
          {s.score === null ? (
            <p className="text-[13.5px] text-ink-soft" data-testid="score-pending">
              A total needs at least {s.needs.trades} closed trades across {s.needs.days} days, so a handful of trades can&apos;t swing it. So far: {data.moneyMetrics.closedTrades} across {data.moneyMetrics.tradingDays}.
            </p>
          ) : (
            <p><span className="figure num text-ink" data-testid="score-total">{s.score}</span> <span className="text-[13px] text-muted">of 100</span></p>
          )}
          <dl className="mt-2">
            {s.axes.map((a) => (
              <Metric key={a.key} def={a} value={a.value === null ? "—" : Math.round(a.value)} note={a.value === null ? a.missing : undefined} />
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}

function DailyPnl({ data, display, search }: WidgetContext) {
  const rows = data.periods.day.slice(-DAILY_BARS);
  return (
    <Card>
      <CardHeader title="Daily P&L" subtitle={`The latest ${rows.length} days with a closed trade, ${zoneName()}. A bar opens that day's trades.`} />
      <BarChart
        bars={rows.map((r) => ({ label: r.key, value: r.pnl, detail: `${r.trades} trades, ${r.wins} won, ${r.losses} lost` }))}
        label="Net P&L per day"
        format={(n) => money(n, display, true)}
        height={220}
        summary="Show the numbers"
        hrefFor={(bar) => {
          const range = periodRange("day", bar.label);
          return range && journalHref(search, range);
        }}
      />
    </Card>
  );
}

/** One month with weekly totals. The Calendar page is the full version: this only reads and links. */
function MiniCalendar({ data, display, search }: WidgetContext) {
  const latest = data.periods.day.at(-1)?.key;
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? latest?.slice(0, 7) ?? "";
  if (!shown) return <Card><CardHeader title="Calendar" /><p className="text-[13.5px] text-muted">Closed trades land here on the day they closed.</p></Card>;
  const anchor = fromKey(shown);
  const [year, mon] = [anchor.getFullYear(), anchor.getMonth()];
  const days = new Map<string, PeriodRow>(data.periods.day.map((r) => [r.key, r]));
  const weeks = new Map<string, PeriodRow>(data.periods.week.map((r) => [r.key, r]));
  const step = (by: number) => setMonth(monthKeyOf(new Date(year, mon + by, 1)));
  const calendarQuery = new URLSearchParams(search);
  calendarQuery.set("month", shown);
  return (
    <Card>
      <CardHeader
        title="Calendar"
        subtitle={anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        action={
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => step(-1)}>Prev</Button>
            <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => step(1)}>Next</Button>
          </span>
        }
      />
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.3fr)] border-t border-line text-[12px]" data-testid="mini-calendar">
        {[...WEEK, "Week"].map((d) => <div key={d} className={cx("py-1 text-muted", d === "Week" && "text-right")}>{d}</div>)}
        {weeksOf(year, mon).map((week) => {
          const total = weeks.get(dayKey(week[0]));
          return [
            ...week.map((d) => {
              const key = dayKey(d);
              const row = d.getMonth() === mon ? days.get(key) : undefined;
              const tint = row ? (row.pnl > 0 ? "bg-profit-soft" : row.pnl < 0 ? "bg-loss-soft" : "bg-raised") : "";
              const label = `${key}${row ? `: ${money(row.pnl, display, true)}, ${row.trades} ${row.trades === 1 ? "trade" : "trades"}` : ""}`;
              return row ? (
                <Link key={key} href={`/calendar?${new URLSearchParams({ ...Object.fromEntries(calendarQuery), day: key })}`} title={label} aria-label={label} className={cx("flex h-9 flex-col justify-between border-t border-line px-1 py-0.5 hover:bg-raised", tint)}>
                  <span className="num text-muted">{d.getDate()}</span>
                  <span className={cx("num truncate text-[11px]", toneOf(row.pnl))}>{compactMoney(row.pnl)}</span>
                </Link>
              ) : (
                <div key={key} className={cx("h-9 border-t border-line px-1 py-0.5", d.getMonth() !== mon && "opacity-40")}><span className="num text-muted">{d.getDate()}</span></div>
              );
            }),
            <div key={`w-${dayKey(week[0])}`} className={cx("num flex h-9 items-center justify-end border-t border-line text-[12px]", total ? toneOf(total.pnl) : "text-muted")}>{total ? compactMoney(total.pnl) : ""}</div>,
          ];
        })}
      </div>
    </Card>
  );
}

function Recent({ recent, accounts, openTrade }: WidgetContext) {
  return (
    <Card>
      <CardHeader title="Recent trades" action={<Link href="/journal" className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">Open the journal</Link>} />
      <table className="w-full text-[13.5px]">
        <thead className="border-b border-line text-left text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-normal">Trade</th>
            <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Side</th>
            <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Source</th>
            <th scope="col" className="py-1.5 pr-3 font-normal whitespace-nowrap">Opened, {zoneName()}</th>
            <th scope="col" className="py-1.5 text-right font-normal">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((t) => (
            <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-raised">
              <td className="py-0 pr-3"><button type="button" onClick={() => openTrade(t.id)} className="min-h-11 text-left font-medium hover:underline sm:min-h-8">{t.symbol}</button></td>
              <td className="hidden py-1 pr-3 sm:table-cell"><SideBadge side={t.side} /></td>
              <td className="hidden py-1 pr-3 sm:table-cell"><SourceBadge source={t.source} /></td>
              <td className="num py-1 pr-3 text-[12.5px] whitespace-nowrap text-ink-soft">{dateTime(t.openedAt)}</td>
              <td className={`num py-1 text-right whitespace-nowrap ${toneOf(t.pnl)}`}>
                {t.pnlStatus !== "ok" ? <PnlIssue status={t.pnlStatus} /> : t.pnl === null ? <span className="font-sans text-muted">Open</span> : money(t.pnl, accounts.find((a) => a.id === t.accountId)?.currency, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function WorthALook({ patterns, toAnswer, coachEnabled, askJarvis }: WidgetContext) {
  return (
    <Card>
      <CardHeader title="Worth a look" />
      <div>
        {patterns.map((p) => (
          <Link key={p.id} href="/patterns" className="block border-b border-line py-2 hover:bg-raised">
            <span className="text-[14px] font-medium">{p.title}</span>
            <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{p.observation}</span>
          </Link>
        ))}
        {toAnswer > 0 && (
          <Link href="/journal?plan=unanswered&range=7d" className="block border-b border-line py-2 text-[13px] text-ink-soft hover:bg-raised">
            {toAnswer} {toAnswer === 1 ? "trade" : "trades"} from the last 7 days {toAnswer === 1 ? "has" : "have"} no answer on following the plan.
          </Link>
        )}
        {patterns.length === 0 && toAnswer === 0 && <p className="text-[13.5px] text-muted">Nothing stands out. Patterns need a few weeks of trades with stops and plan answers.</p>}
        {coachEnabled && (
          <Button size="sm" className="mt-3" onClick={() => askJarvis("Summarise my recent trades and what stands out.")}>
            Ask the AI Coach for a summary
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Each widget draws itself from the same analytics response, so none of them can disagree. */
export function Widget({ id, ctx }: { id: WidgetId; ctx: WidgetContext }) {
  const { data, display, search, openTrade } = ctx;
  const m = data.metrics;
  const b = data.breakdowns;
  switch (id) {
    case "tape":
      return (
        <Tape
          equity={data.equity}
          drawdown={data.drawdown}
          currency={display}
          netPnl={m.netPnl}
          summary={<>{m.closedTrades} closed{m.winRate === null ? "" : `, ${pct(m.winRate)} won`}{m.openTrades > 0 ? `, ${m.openTrades} still open` : ""}</>}
          symbols={ctx.symbols}
          rangeActive={ctx.rangeActive}
          onOpen={openTrade}
          onBrush={ctx.brush}
          onClearRange={ctx.clearRange}
        />
      );
    case "score":
      return <Score {...ctx} />;
    case "dailyPnl":
      return <DailyPnl {...ctx} />;
    case "calendar":
      return <MiniCalendar {...ctx} />;
    case "recent":
      return <Recent {...ctx} />;
    case "worth":
      return <WorthALook {...ctx} />;
    case "result":
      return (
        <Ledger title="Result">
          <Metric def={D.netPnl} value={money(m.netPnl, display, true)} tone={toneOf(m.netPnl)} />
          <Metric def={D.grossProfit} value={money(m.grossProfit, display)} tone="text-profit" />
          <Metric def={D.grossLoss} value={money(m.grossLoss, display)} tone={m.grossLoss ? "text-loss" : undefined} />
          <Metric def={D.profitFactor} value={profitFactorText(m)} />
          <Metric def={D.expectancy} value={money(m.expectancy, display, true)} tone={toneOf(m.expectancy)} />
        </Ledger>
      );
    case "quality":
      return (
        <Ledger title="Quality">
          <Metric def={D.winRate} value={pct(m.winRate, 1)} />
          <Metric def={D.avgR} value={rFmt(m.avgR)} tone={toneOf(m.avgR)} note={m.rSample ? `${m.rSample} trades with a stop` : "Needs trades with a stop"} />
          <Metric def={D.avgWin} value={money(m.avgWin, display, true)} tone={m.avgWin === null ? undefined : "text-profit"} />
          <Metric def={D.avgLoss} value={money(m.avgLoss, display, true)} tone={m.avgLoss === null ? undefined : "text-loss"} />
          <Metric def={D.bestTrade} value={m.bestTrade ? <button type="button" className="text-[13px] underline underline-offset-2 hover:text-ink" onClick={() => openTrade(m.bestTrade!.id)}>{m.bestTrade.symbol} {money(m.bestTrade.pnl, display, true)}</button> : "—"} />
          <Metric def={D.worstTrade} value={m.worstTrade ? <button type="button" className="text-[13px] underline underline-offset-2 hover:text-ink" onClick={() => openTrade(m.worstTrade!.id)}>{m.worstTrade.symbol} {money(m.worstTrade.pnl, display, true)}</button> : "—"} />
        </Ledger>
      );
    case "risk":
      return (
        <Ledger title="Risk">
          <Metric def={D.maxDrawdown} value={money(-m.maxDrawdown, display)} tone={m.maxDrawdown ? "text-loss" : undefined} />
          {/* Costs are money whatever unit the results are shown in. */}
          <Metric def={D.totalFees} value={money(m.totalFees, data.currency)} />
          <Metric def={D.maxConsecutiveLosses} value={m.maxConsecutiveLosses} />
          <Metric def={D.maxConsecutiveWins} value={m.maxConsecutiveWins} />
        </Ledger>
      );
    case "activity":
      return (
        <Ledger title="Activity">
          <Metric def={D.totalTrades} value={m.totalTrades} />
          <Metric def={D.closedTrades} value={m.closedTrades} />
          <Metric def={D.openTrades} value={m.openTrades} />
          <Metric def={D.wins} value={m.wins} />
          <Metric def={D.losses} value={m.losses} />
          <Metric def={D.breakeven} value={m.breakeven} />
          <Metric def={D.avgHold} value={duration(m.avgHoldMin)} />
        </Ledger>
      );
    case "days":
      return (
        <Ledger title="Your days">
          <Metric def={D.dayWinRate} value={`${m.winningDays} of ${m.tradingDays}, ${pct(m.dayWinRate)}`} />
          <Metric def={D.avgDailyPnl} value={money(m.avgDailyPnl, display, true)} tone={toneOf(m.avgDailyPnl)} />
          <Metric def={D.bestDay} value={m.bestDay ? money(m.bestDay.pnl, display, true) : "—"} tone={toneOf(m.bestDay?.pnl)} note={m.bestDay?.date} />
          <Metric def={D.worstDay} value={m.worstDay ? money(m.worstDay.pnl, display, true) : "—"} tone={toneOf(m.worstDay?.pnl)} note={m.worstDay?.date} />
          <Metric def={D.currentStreak} value={m.currentStreak === 0 ? "None" : `${Math.abs(m.currentStreak)} ${m.currentStreak > 0 ? "won" : "lost"}`} tone={toneOf(m.currentStreak)} />
        </Ledger>
      );
    case "drawdown":
      return (
        <Card>
          <CardHeader title="Drawdown" subtitle={`Fall from the running peak. Deepest: ${money(-m.maxDrawdown, display)}.`} />
          <LineChart label="Drawdown" points={data.drawdown.map((p) => ({ at: p.at, value: p.drawdown }))} currency={display} tone="loss" height={200} />
        </Card>
      );
    case "distribution":
      return (
        <Card>
          <CardHeader title="Win and loss distribution" subtitle="Closed trades per result bucket." />
          <Histogram buckets={data.distribution} currency={display} />
        </Card>
      );
    case "strategy":
      return (
        <Card>
          <CardHeader title="Strategies" />
          <BreakdownTable compact rows={b.strategy} currency={display} group="Strategy" hrefFor={(k) => (k === "(no strategy)" ? null : journalHref(search, { strategy: k }))} />
        </Card>
      );
    case "symbol":
      return (
        <Card>
          <CardHeader title="Instruments" />
          <BreakdownTable compact rows={b.symbol} currency={display} group="Instrument" hrefFor={(k) => journalHref(search, { symbol: k })} />
        </Card>
      );
    case "mistakes":
      return (
        <Card>
          <CardHeader title="Mistakes" />
          <BreakdownTable compact rows={b.mistake} currency={display} group="Mistake" label={nice} empty="No mistakes marked on these closed trades." hrefFor={(k) => journalHref(search, { mistake: k })} />
        </Card>
      );
    case "tags":
      return (
        <Card>
          <CardHeader title="Tags" />
          <BreakdownTable compact rows={b.tag} currency={display} group="Tag" empty="No tags on these closed trades." hrefFor={(k) => journalHref(search, { tag: k })} />
        </Card>
      );
    case "weekday":
      return (
        <Card>
          <CardHeader title="Day of week" subtitle="By the day a trade opened." />
          <BreakdownTable compact rows={[...b.weekday].sort((x, y) => WEEK.indexOf(x.key) - WEEK.indexOf(y.key))} currency={display} group="Day" hrefFor={(k) => (WEEKDAYS.includes(k) ? journalHref(search, { weekday: String(WEEKDAYS.indexOf(k)) }) : null)} />
        </Card>
      );
    case "hour":
      return (
        <Card>
          <CardHeader title="Time of day" subtitle="By the hour a trade opened." />
          <BreakdownTable compact rows={[...b.hour].sort((x, y) => x.key.localeCompare(y.key))} currency={display} group="Hour" hrefFor={(k) => journalHref(search, { hour: String(Number(k.slice(0, 2))) })} />
        </Card>
      );
  }
}
