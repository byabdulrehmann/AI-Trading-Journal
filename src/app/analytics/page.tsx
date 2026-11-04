"use client";

import { useMemo, useState } from "react";
import { useApp, useCurrency } from "@/lib/client/app-state";
import { duration, money, pct, rFmt, toneOf } from "@/lib/client/format";
import { breakdown, computeMetrics, dailySummaries, equityCurve, METRIC_DEFINITIONS, type DaySummary } from "@/lib/domain/metrics";
import { EquityChart, PnlCalendar, ValueBar } from "@/components/charts";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Button, Card, CardHeader, EmptyState, PageHeader, Segmented, Spinner, Stat, inputClass } from "@/components/ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Dim = "symbol" | "setup" | "side" | "emotion" | "weekday" | "hour";

export default function AnalyticsPage() {
  const { trades, reportTrades, accounts, currencies, loading, openTrade, editTrade } = useApp();
  const currency = useCurrency();
  const [pickedAccount, setAccount] = useState("all");
  const [dim, setDim] = useState<Dim>("symbol");
  // null = follow the latest closed trade; set once the user pages months.
  const [pickedMonth, setMonth] = useState<Date | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);

  const inCurrency = accounts.filter((a) => a.currency === currency);
  // Switching currency can leave the picked account out of scope; fall back to all of them.
  const account = inCurrency.some((a) => String(a.id) === pickedAccount) ? pickedAccount : "all";
  const scoped = useMemo(() => (account === "all" ? reportTrades : reportTrades.filter((t) => String(t.accountId) === account)), [reportTrades, account]);
  const m = useMemo(() => computeMetrics(scoped), [scoped]);
  const curve = useMemo(() => equityCurve(scoped), [scoped]);
  const days = useMemo(() => dailySummaries(scoped), [scoped]);
  const rows = useMemo(
    () =>
      breakdown(scoped, (t) => {
        switch (dim) {
          case "symbol": return t.symbol;
          case "setup": return t.setup || "(no setup)";
          case "side": return t.side;
          case "emotion": return t.emotionBefore ?? "(not recorded)";
          case "weekday": return WEEKDAYS[new Date(t.openedAt).getDay()];
          case "hour": return `${String(new Date(t.openedAt).getHours()).padStart(2, "0")}:00`;
        }
      }),
    [scoped, dim],
  );
  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.netPnl)));

  if (loading) return <Spinner />;
  if (!trades.some((t) => t.pnl !== null))
    return (
      <>
        <PageHeader title="Analytics" />
        <EmptyState title="Nothing to analyse yet" body="Analytics use closed trades. Log or import a few and come back." action={<Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>} />
      </>
    );

  const D = METRIC_DEFINITIONS;
  // Computed after the loading guard, so it never runs during prerender.
  const latestClose = curve.at(-1)?.at;
  const anchor = latestClose ? new Date(latestClose) : new Date();
  const month = pickedMonth ?? new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const shiftMonth = (n: number) => {
    setDay(null);
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        description="All figures are computed from your recorded trades. Tap ƒ on any number to see its formula."
        actions={
          <>
            <CurrencyPicker />
            <select aria-label="Account" className={inputClass + " w-auto"} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="all">{currencies.length > 1 ? `All ${currency} accounts` : "All accounts"}</option>
              {inCurrency.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Stat def={D.netPnl} value={money(m.netPnl, currency, true)} tone={toneOf(m.netPnl)} note={`${m.closedTrades} closed trades`} />
        <Stat def={D.winRate} value={pct(m.winRate, 1)} note={`${m.wins} wins · ${m.losses} losses`} />
        <Stat def={D.profitFactor} value={m.profitFactor === null ? "—" : m.profitFactor === Infinity ? "∞" : m.profitFactor.toFixed(2)} />
        <Stat def={D.expectancy} value={money(m.expectancy, currency, true)} tone={toneOf(m.expectancy)} />
        <Stat def={D.avgR} value={rFmt(m.avgR)} tone={toneOf(m.avgR)} note={`${m.rSample} trades with a stop`} />
        <Stat def={D.maxDrawdown} value={money(-m.maxDrawdown, currency)} tone={m.maxDrawdown ? "text-loss" : undefined} />
        <Stat def={D.avgWin} value={money(m.avgWin, currency, true)} tone="text-profit" />
        <Stat def={D.avgLoss} value={money(m.avgLoss, currency, true)} tone="text-loss" />
        <Stat def={D.planAdherence} value={pct(m.planAdherence)} note={`${m.planSample} answered`} />
        <Stat def={D.holdWinners} value={duration(m.holdWinnersMin)} />
        <Stat def={D.holdLosers} value={duration(m.holdLosersMin)} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Equity curve" subtitle="Cumulative net P&L, ordered by close time" />
        <div className="p-4"><EquityChart points={curve} currency={currency} onSelect={openTrade} /></div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="P&L calendar"
            subtitle="By the day trades closed (your local time)"
            action={
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</Button>
                <span className="w-32 text-center text-[13.5px]">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
                <Button size="sm" variant="ghost" onClick={() => shiftMonth(1)} aria-label="Next month">›</Button>
              </div>
            }
          />
          <div className="p-4">
            <PnlCalendar days={days} month={month} currency={currency} onPickDay={setDay} selected={day?.date ?? null} />
            {day && (
              <div className="mt-4 rounded-lg border border-line p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-medium">{new Date(day.date + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h3>
                  <span className={`num ${toneOf(day.pnl)}`}>{money(day.pnl, currency, true)}</span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {day.tradeIds.map((id) => {
                    const t = trades.find((x) => x.id === id)!;
                    return (
                      <li key={id}>
                        <button type="button" onClick={() => openTrade(id)} className="num rounded-md border border-line px-2 py-1 text-[12.5px] hover:border-accent">
                          #{id} {t.symbol} <span className={toneOf(t.pnl)}>{money(t.pnl, currency, true)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Breakdown" subtitle="Net P&L and win rate by group" />
          <div className="p-4">
            <div className="mb-3 overflow-x-auto">
              <Segmented
                label="Group by"
                value={dim}
                onChange={setDim}
                options={[
                  { value: "symbol", label: "Symbol" },
                  { value: "setup", label: "Setup" },
                  { value: "emotion", label: "Feeling" },
                  { value: "weekday", label: "Day" },
                  { value: "hour", label: "Hour" },
                  { value: "side", label: "Side" },
                ]}
              />
            </div>
            <table className="w-full text-[13.5px]">
              <thead className="text-left text-[12px] text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Group</th>
                  <th className="py-1.5 text-right font-medium">Trades</th>
                  <th className="py-1.5 text-right font-medium">Win</th>
                  <th className="py-1.5 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-2 pr-2">
                      <div className="truncate">{r.key}</div>
                      <ValueBar value={r.netPnl} max={maxAbs} />
                    </td>
                    <td className="num py-2 text-right text-ink-soft">{r.trades}</td>
                    <td className="num py-2 text-right text-ink-soft">{pct(r.winRate)}</td>
                    <td className={`num py-2 text-right ${toneOf(r.netPnl)}`}>{money(r.netPnl, currency, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-muted">Small groups swing a lot. Treat groups with fewer than ~10 trades as anecdotes.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
