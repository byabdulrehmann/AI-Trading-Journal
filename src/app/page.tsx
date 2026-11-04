"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp, useCurrency } from "@/lib/client/app-state";
import { dateTime, money, pct, rFmt, toneOf } from "@/lib/client/format";
import { computeMetrics, equityCurve, METRIC_DEFINITIONS } from "@/lib/domain/metrics";
import { detectPatterns } from "@/lib/domain/patterns";
import type { Trade } from "@/lib/domain/types";
import { EquityChart } from "@/components/charts";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Segmented, Spinner, Stat } from "@/components/ui";

type Range = "30" | "90" | "all";

function inRange(t: Trade, range: Range) {
  if (range === "all") return true;
  return Date.parse(t.openedAt) >= Date.now() - Number(range) * 86400000;
}

/** Gentle, evidence-based prompts drawn from gaps in the user's own records. */
function reflectionPrompts(trades: Trade[]): { text: string; href: string }[] {
  const recent = trades.filter((t) => Date.parse(t.openedAt) >= Date.now() - 7 * 86400000);
  const out: { text: string; href: string }[] = [];
  const ungraded = recent.filter((t) => t.closedAt && !t.grade).length;
  if (ungraded) out.push({ text: `${ungraded} closed trade${ungraded > 1 ? "s" : ""} from the last 7 days ha${ungraded > 1 ? "ve" : "s"} no grade yet.`, href: "/journal" });
  const noPlan = recent.filter((t) => t.followedPlan === null).length;
  if (noPlan) out.push({ text: `You haven't said whether you followed the plan on ${noPlan} recent trade${noPlan > 1 ? "s" : ""}.`, href: "/journal" });
  const noStop = recent.filter((t) => t.stopPrice === null).length;
  if (noStop) out.push({ text: `${noStop} recent trade${noStop > 1 ? "s have" : " has"} no stop recorded, so R can't be measured.`, href: "/journal" });
  return out.slice(0, 3);
}

export default function OverviewPage() {
  const { trades, reportTrades, loading, loadError, settings, editTrade, openTrade, refresh, toast, askJarvis, saveSettings } = useApp();
  const currency = useCurrency();
  const [range, setRange] = useState<Range>("30");
  const scoped = useMemo(() => reportTrades.filter((t) => inRange(t, range)), [reportTrades, range]);
  const m = useMemo(() => computeMetrics(scoped), [scoped]);
  const curve = useMemo(() => equityCurve(scoped), [scoped]);
  const patterns = useMemo(
    () => (settings?.jarvis.behaviouralInsights ? detectPatterns(reportTrades).filter((p) => !settings.dismissedPatterns.includes(p.id)) : []),
    [reportTrades, settings],
  );
  const prompts = useMemo(() => (settings?.jarvis.reflectionPrompts ? reflectionPrompts(trades) : []), [trades, settings]);

  const loadSample = async () => {
    const res = await api<{ added: number }>("/api/data/sample", { method: "POST" });
    await refresh();
    toast({ message: res.added ? `Loaded ${res.added} sample trades. Remove them any time in Settings.` : "Sample data is already loaded.", tone: "success" });
  };

  if (loading) return <Spinner label="Loading your journal" />;
  if (loadError)
    return <EmptyState title="Couldn't load your journal" body={loadError} action={<Button onClick={() => void refresh()}>Try again</Button>} />;

  const hasSample = trades.some((t) => t.source === "sample");
  const greeting = settings?.displayName ? `Welcome back, ${settings.displayName}` : "Overview";

  return (
    <>
      <PageHeader
        title={greeting}
        description="Your recorded results, the patterns in them, and what to review next."
        actions={trades.length > 0 && (
          <>
            <CurrencyPicker />
            <Segmented label="Time range" value={range} onChange={setRange} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "all", label: "All" }]} />
          </>
        )}
      />

      {trades.length === 0 && !settings?.onboardingDismissed && (
        <Card className="mb-6">
          <CardHeader title="Get set up" subtitle="Three ways to start. Everything stays on this computer." action={<Button variant="ghost" size="sm" onClick={() => void saveSettings({ onboardingDismissed: true })}>Hide</Button>} />
          <ol className="grid gap-4 p-5 sm:grid-cols-3">
            <li className="rounded-lg border border-line p-4">
              <h3 className="font-medium">Log a trade</h3>
              <p className="mt-1 text-[13px] text-muted">Record entry, stop, target and how you felt.</p>
              <Button className="mt-3" size="sm" variant="primary" onClick={() => editTrade("new")}>Log a trade</Button>
            </li>
            <li className="rounded-lg border border-line p-4">
              <h3 className="font-medium">Import a CSV</h3>
              <p className="mt-1 text-[13px] text-muted">Map the columns from your broker&apos;s export.</p>
              <Link href="/journal?import=1" className="mt-3 inline-flex h-8 items-center rounded-md border border-line-strong px-3 text-[13px] hover:border-muted">Import</Link>
            </li>
            <li className="rounded-lg border border-line p-4">
              <h3 className="font-medium">Explore with sample data</h3>
              <p className="mt-1 text-[13px] text-muted">60-odd clearly marked demo trades. Remove them later in Settings.</p>
              <Button className="mt-3" size="sm" onClick={loadSample}>Load sample journal</Button>
            </li>
          </ol>
        </Card>
      )}

      {trades.length === 0 ? (
        <EmptyState title="No trades yet" body="Once you log or import trades, your results and patterns appear here." action={<Button variant="primary" onClick={() => editTrade("new")}>Log your first trade</Button>} />
      ) : (
        <div className="space-y-6">
          {hasSample && (
            <p className="text-[13px] text-muted">
              <Badge tone="info">Sample</Badge> Your journal includes sample trades. <Link className="text-accent underline" href="/settings#data">Remove them</Link> when you&apos;re ready.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat def={METRIC_DEFINITIONS.netPnl} value={money(m.netPnl, currency, true)} tone={toneOf(m.netPnl)} note={`${m.closedTrades} closed · ${m.openTrades} open`} />
            <Stat def={METRIC_DEFINITIONS.winRate} value={pct(m.winRate)} note={`${m.wins}W / ${m.losses}L`} />
            <Stat def={METRIC_DEFINITIONS.avgR} value={rFmt(m.avgR)} tone={toneOf(m.avgR)} note={`${m.rSample} trades with a stop`} />
            <Stat def={METRIC_DEFINITIONS.planAdherence} value={pct(m.planAdherence)} note={`${m.planSample} answered`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Equity curve" subtitle="Cumulative net P&L of closed trades. Click a point to open the trade." action={<Link href="/analytics" className="text-[13px] text-accent hover:underline">Analytics →</Link>} />
              <div className="p-4">{curve.length ? <EquityChart points={curve} currency={currency} onSelect={openTrade} /> : <p className="text-[14px] text-muted">No closed trades in this range.</p>}</div>
            </Card>

            <Card>
              <CardHeader title="Worth a look" subtitle="From your own records" />
              <div className="space-y-3 p-4">
                {patterns.slice(0, 2).map((p) => (
                  <Link key={p.id} href="/patterns" className="block rounded-lg border border-line p-3 hover:border-line-strong">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] font-medium">{p.title}</span>
                      {p.cost !== null && <span className={`num text-[13px] whitespace-nowrap ${toneOf(p.cost)}`}>{money(p.cost, currency, true)}</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-muted">{p.observation}</p>
                  </Link>
                ))}
                {prompts.map((p) => (
                  <Link key={p.text} href={p.href} className="block rounded-lg border border-dashed border-line-strong p-3 text-[13px] text-ink-soft hover:border-accent">
                    {p.text}
                  </Link>
                ))}
                {patterns.length === 0 && prompts.length === 0 && <p className="text-[13px] text-muted">Nothing stands out right now. Patterns need a few weeks of entries.</p>}
                {settings?.jarvis.enabled && (
                  <Button size="sm" className="w-full" onClick={() => askJarvis(`Summarise my last ${range === "all" ? "trades" : `${range} days`} and what stands out.`)}>
                    Ask Jarvis for a summary
                  </Button>
                )}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="Recent trades" action={<Link href="/journal" className="text-[13px] text-accent hover:underline">Journal →</Link>} />
            <ul className="divide-y divide-line">
              {reportTrades.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openTrade(t.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-raised/50">
                    <span className="num w-10 text-[12px] text-muted">#{t.id}</span>
                    <span className="w-20 font-medium">{t.symbol}</span>
                    <Badge tone={t.side === "long" ? "info" : "accent"}>{t.side}</Badge>
                    <span className="hidden text-[13px] text-muted sm:inline">{dateTime(t.openedAt)}</span>
                    {t.source === "sample" && <Badge tone="info" className="hidden sm:inline-flex">Sample</Badge>}
                    <span className={`num ml-auto text-[14px] ${toneOf(t.pnl)}`}>{t.pnl === null ? "Open" : money(t.pnl, currency, true)}</span>
                    <span className="num hidden w-16 text-right text-[13px] text-muted sm:inline">{rFmt(t.rMultiple)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
