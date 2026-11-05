"use client";

import Link from "next/link";
import { useMemo } from "react";
import { api } from "@/lib/client/api";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { dateTime, duration, money, pct, profitFactorText, rFmt, toneOf } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { METRIC_DEFINITIONS as D } from "@/lib/domain/metrics";
import type { Trade } from "@/lib/domain/types";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { PnlIssue, SideBadge, SourceBadge } from "@/components/journal/badges";
import { DashboardSkeleton } from "@/components/tape/Skeletons";
import { Tape } from "@/components/tape/Tape";
import { useSymbols } from "@/components/tape/use-symbols";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, CardHeader, EmptyState, Metric, Notice } from "@/components/ui";

export default function DashboardPage() {
  return (
    <Suspended>
      <Dashboard />
    </Suspended>
  );
}

function sevenDaysAgo() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).toISOString();
}

const smallLink = "inline-flex h-8 items-center border border-line-strong px-3 text-[13px] hover:border-muted";

function LedgerColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="py-2.5 text-[15px] font-medium text-ink">{title}</h2>
      <dl>{children}</dl>
    </Card>
  );
}

function Dashboard() {
  const { settings, saveSettings, editTrade, openTrade, askJarvis, refresh, toast, accounts } = useApp();
  const filters = useUrlFilters();
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);
  const recent = useFetch<{ trades: Trade[] }>(data ? `/api/trades?${filters.apiQuery({ extra: { pageSize: "8", currency: data.currency } })}` : null);
  const symbols = useSymbols(data && data.equity.length ? filters.apiQuery({ extra: { currency: data.currency } }) : null);
  const week = useMemo(() => sevenDaysAgo(), []);
  const unanswered = useFetch<{ total: number }>(settings?.jarvis.reflectionPrompts ? `/api/trades?plan=unanswered&from=${encodeURIComponent(week)}&pageSize=1` : null);

  const loadSample = async () => {
    const res = await api<{ added: number }>("/api/data/sample", { method: "POST" });
    filters.set({ includeSample: "1" });
    await refresh();
    toast({ message: res.added ? `Loaded ${res.added} sample trades. Remove them any time in Settings.` : "Sample data is already loaded.", tone: "success" });
  };

  if (error && !data) return <EmptyState title="Couldn't load your dashboard" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <DashboardSkeleton />;

  const m = data.metrics;
  const cur = data.currency;
  const none = m.totalTrades === 0;
  const patterns = settings?.jarvis.behaviouralInsights ? data.patterns.filter((p) => !settings.dismissedPatterns.includes(p.id)).slice(0, 2) : [];
  const pendingLink = `/journal?outcome=pending${filters.get("includeSample") ? "&includeSample=1" : ""}`;
  const toAnswer = unanswered.data?.total ?? 0;
  // A sample-only journal still counts as started: the filter bar above offers to show it.
  const fresh = none && !filters.active && !data.sampleHidden;

  return (
    <div className={loading ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="text-[18px] leading-tight font-medium text-ink">{settings?.displayName ? `Welcome back, ${settings.displayName}` : "Dashboard"}</h1>
        <CurrencyPicker currency={cur} currencies={data.currencies} filters={filters} />
      </div>
      <TradeFilters filters={filters} />

      {none && filters.active && <EmptyState title="No trades match these filters" body="Widen the date range or clear the filters to see more." action={<Button onClick={filters.clear}>Clear filters</Button>} />}
      {none && !filters.active && data.sampleHidden && <EmptyState title="Only sample trades so far" body="Include the sample data above to explore, or log your own first trade." action={<Button variant="primary" onClick={() => editTrade("new")}>Log a trade</Button>} />}
      {fresh && !settings?.onboardingDismissed && (
        <Card>
          <CardHeader title="Start your journal" subtitle="Everything stays on this computer." action={<Button variant="ghost" size="sm" onClick={() => void saveSettings({ onboardingDismissed: true })}>Hide</Button>} />
          <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <li className="p-card">
              <h3 className="font-medium">Log a trade</h3>
              <p className="mt-1 text-[13.5px] text-muted">Enter one by hand: entry, stop, target and how it went.</p>
              <Button className="mt-3" size="sm" variant="primary" onClick={() => editTrade("new")}>Log a trade</Button>
            </li>
            <li className="p-card">
              <h3 className="font-medium">Import or connect</h3>
              <p className="mt-1 text-[13.5px] text-muted">Bring in a broker CSV, or link MetaTrader 5.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/journal?import=1" className={smallLink}>Import CSV</Link>
                <Link href="/accounts" className={smallLink}>Accounts &amp; MT5</Link>
              </div>
            </li>
            <li className="p-card">
              <h3 className="font-medium">Try it with sample data</h3>
              <p className="mt-1 text-[13.5px] text-muted">Made-up trades, always labelled Sample, removable in Settings.</p>
              <Button className="mt-3" size="sm" onClick={() => void loadSample()}>Load sample journal</Button>
            </li>
          </ul>
        </Card>
      )}
      {fresh && settings?.onboardingDismissed && <EmptyState title="No trades yet" body="Log your first trade, or import a CSV from the Journal." action={<Button variant="primary" onClick={() => editTrade("new")}>Log a trade</Button>} />}

      {!none && (
        <div className="space-y-section">
          <Tape
            equity={data.equity}
            drawdown={data.drawdown}
            currency={cur}
            netPnl={m.netPnl}
            summary={<>{m.closedTrades} closed{m.winRate === null ? "" : `, ${pct(m.winRate)} won`}{m.openTrades > 0 ? `, ${m.openTrades} still open` : ""}</>}
            symbols={symbols}
            rangeActive={Boolean(filters.get("range"))}
            onOpen={openTrade}
            onBrush={(from, to) => filters.set({ range: "custom", from, to })}
            onClearRange={() => filters.set({ range: null, from: null, to: null })}
          />

          {m.excludedTrades > 0 && (
            <Notice action={<Link href={pendingLink} className="text-[13.5px] font-medium text-ink underline underline-offset-2">Show {m.excludedTrades === 1 ? "that trade" : "those trades"}</Link>}>
              {m.excludedTrades} closed {m.excludedTrades === 1 ? "trade is" : "trades are"} left out of these figures, because a conversion rate to {cur} is missing or the fills don&apos;t add up. Enter the rate on the trade to include it.
            </Notice>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            <LedgerColumn title="Result">
              <Metric def={D.netPnl} value={money(m.netPnl, cur, true)} tone={toneOf(m.netPnl)} />
              <Metric def={D.grossProfit} value={money(m.grossProfit, cur)} tone="text-profit" />
              <Metric def={D.grossLoss} value={money(m.grossLoss, cur)} tone={m.grossLoss ? "text-loss" : undefined} />
              <Metric def={D.profitFactor} value={profitFactorText(m)} />
              <Metric def={D.expectancy} value={money(m.expectancy, cur, true)} tone={toneOf(m.expectancy)} />
            </LedgerColumn>
            <LedgerColumn title="Quality">
              <Metric def={D.winRate} value={pct(m.winRate, 1)} />
              <Metric def={D.avgR} value={rFmt(m.avgR)} tone={toneOf(m.avgR)} note={m.rSample ? `${m.rSample} trades with a stop` : "Needs trades with a stop"} />
              <Metric def={D.avgWin} value={money(m.avgWin, cur, true)} tone={m.avgWin === null ? undefined : "text-profit"} />
              <Metric def={D.avgLoss} value={money(m.avgLoss, cur, true)} tone={m.avgLoss === null ? undefined : "text-loss"} />
              <Metric def={D.bestTrade} value={m.bestTrade ? <button type="button" className="text-[13px] underline underline-offset-2 hover:text-ink" onClick={() => openTrade(m.bestTrade!.id)}>{m.bestTrade.symbol} {money(m.bestTrade.pnl, cur, true)}</button> : "—"} />
              <Metric def={D.worstTrade} value={m.worstTrade ? <button type="button" className="text-[13px] underline underline-offset-2 hover:text-ink" onClick={() => openTrade(m.worstTrade!.id)}>{m.worstTrade.symbol} {money(m.worstTrade.pnl, cur, true)}</button> : "—"} />
            </LedgerColumn>
            <LedgerColumn title="Risk">
              <Metric def={D.maxDrawdown} value={money(-m.maxDrawdown, cur)} tone={m.maxDrawdown ? "text-loss" : undefined} />
              <Metric def={D.totalFees} value={money(m.totalFees, cur)} />
              <Metric def={D.maxConsecutiveLosses} value={m.maxConsecutiveLosses} />
              <Metric def={D.maxConsecutiveWins} value={m.maxConsecutiveWins} />
            </LedgerColumn>
            <LedgerColumn title="Activity">
              <Metric def={D.totalTrades} value={m.totalTrades} />
              <Metric def={D.closedTrades} value={m.closedTrades} />
              <Metric def={D.openTrades} value={m.openTrades} />
              <Metric def={D.wins} value={m.wins} />
              <Metric def={D.losses} value={m.losses} />
              <Metric def={D.breakeven} value={m.breakeven} />
              <Metric def={D.avgHold} value={duration(m.avgHoldMin)} />
            </LedgerColumn>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Recent trades" action={<Link href="/journal" className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">Open the journal</Link>} />
              <table className="w-full text-[13.5px]">
                <thead className="border-b border-line text-left text-[12.5px] text-muted">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-normal">Trade</th>
                    <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Side</th>
                    <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Source</th>
                    <th scope="col" className="py-1.5 pr-3 font-normal whitespace-nowrap">Opened, local time</th>
                    <th scope="col" className="py-1.5 text-right font-normal">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {(recent.data?.trades ?? []).map((t) => (
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
                {settings?.jarvis.enabled && (
                  <Button size="sm" className="mt-3" onClick={() => askJarvis("Summarise my recent trades and what stands out.")}>
                    Ask the AI Coach for a summary
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
