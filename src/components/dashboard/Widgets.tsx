"use client";

import Link from "next/link";
import type { Analytics } from "@/lib/client/analytics";
import { duration, money, pct, profitFactorText, rFmt, toneOf } from "@/lib/client/format";
import { journalHref } from "@/lib/client/journal-links";
import type { WidgetId } from "@/lib/domain/dashboard";
import { METRIC_DEFINITIONS as D } from "@/lib/domain/metrics";
import type { PatternFinding } from "@/lib/domain/patterns";
import { BreakdownTable, Histogram, LineChart } from "@/components/charts";
import { Button, Card, CardHeader, Metric } from "@/components/ui";

export interface WidgetContext {
  data: Analytics;
  /** What results are shown in: a currency, or %, R or pips. */
  display: string;
  search: string;
  patterns: PatternFinding[];
  toAnswer: number;
  coachEnabled: boolean;
  openTrade: (id: number) => void;
  askJarvis: (prompt: string) => void;
}

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
    // Drawn by the fixed layout above the grid (Board.tsx); kept as ids so saved layouts still parse.
    case "tape":
    case "score":
    case "dailyPnl":
    case "calendar":
    case "recent":
      return null;
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
