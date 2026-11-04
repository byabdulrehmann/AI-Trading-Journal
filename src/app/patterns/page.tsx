"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp, useCurrency } from "@/lib/client/app-state";
import { money, toneOf } from "@/lib/client/format";
import { detectPatterns, PATTERN_RULES, type PatternFinding } from "@/lib/domain/patterns";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function PatternsPage() {
  const { trades, reportTrades, loading, settings, saveSettings, openTrade, askJarvis, toast } = useApp();
  const currency = useCurrency();
  const [showRules, setShowRules] = useState(false);
  const all = useMemo(() => detectPatterns(reportTrades), [reportTrades]);
  const dismissed = settings?.dismissedPatterns ?? [];
  const active = all.filter((p) => !dismissed.includes(p.id));
  const hidden = all.filter((p) => dismissed.includes(p.id));
  const totalCost = active.reduce((a, p) => a + (p.cost !== null && p.cost < 0 ? p.cost : 0), 0);

  const dismiss = async (p: PatternFinding) => {
    await saveSettings({ dismissedPatterns: [...dismissed, p.id] });
    toast({ message: `Hidden "${p.title}". Jarvis won't mention it either.`, action: { label: "Undo", run: () => void saveSettings({ dismissedPatterns: dismissed }) } });
  };

  if (loading) return <Spinner />;

  if (settings && !settings.jarvis.behaviouralInsights)
    return (
      <>
        <PageHeader title="Patterns" />
        <EmptyState
          title="Behavioural insights are off"
          body="You turned off pattern detection. Nothing is analysed or shown here, and Jarvis doesn't receive patterns."
          action={<Button onClick={() => void saveSettings({ jarvis: { behaviouralInsights: true } })}>Turn back on</Button>}
        />
      </>
    );

  return (
    <>
      <PageHeader
        title="Patterns"
        description="Rule-based checks over your records. Each one shows the trades behind it. They describe what happened, not why — you're the judge of that."
        actions={
          <>
            <CurrencyPicker />
            <Button variant="ghost" onClick={() => setShowRules((s) => !s)} aria-expanded={showRules}>{showRules ? "Hide the rules" : "How patterns are detected"}</Button>
          </>
        }
      />

      {showRules && (
        <Card className="mb-6 p-5">
          <ul className="grid gap-3 text-[13.5px] sm:grid-cols-2">
            {Object.entries(PATTERN_RULES).map(([id, r]) => (
              <li key={id} className="rounded-lg border border-line p-3">
                <p className="font-medium text-ink">{r.title}</p>
                <p className="mt-1 text-ink-soft">{r.rule}</p>
                <p className="mt-1 text-[12px] text-muted">Needs at least {r.minSample}.</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {active.length > 0 && totalCost < 0 && (
        <Card className="mb-6 flex flex-wrap items-center gap-4 p-5">
          <div>
            <p className="text-[13px] text-muted">Combined P&L of the trades behind these patterns</p>
            <p className={`num text-2xl ${toneOf(totalCost)}`}>{money(totalCost, currency, true)}</p>
          </div>
          <p className="max-w-md text-[13px] text-muted">Patterns can share trades, so this is a rough size of what&apos;s at stake, not a precise cost.</p>
        </Card>
      )}

      {active.length === 0 ? (
        <EmptyState
          title={trades.length ? "No patterns stand out" : "No trades yet"}
          body={trades.length ? "None of the rules fire on your current records. Keep recording plan adherence, emotions and stops — most rules need a few weeks of data." : "Log or import trades to start."}
        />
      ) : (
        <div className="space-y-4">
          {active.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold">{p.title}</h2>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge tone={p.confidence === "medium" ? "accent" : "neutral"}>{p.confidence} confidence</Badge>
                    <Badge>{p.occurrences} trades</Badge>
                  </div>
                </div>
                {p.cost !== null && <span className={`num text-[18px] ${toneOf(p.cost)}`}>{money(p.cost, currency, true)}</span>}
              </div>
              <dl className="mt-4 space-y-2 text-[14px]">
                <div><dt className="inline font-semibold text-info">Recorded: </dt><dd className="inline text-ink">{p.observation}</dd></div>
                <div><dt className="inline font-semibold text-accent">Possible reading: </dt><dd className="inline text-ink-soft">{p.interpretation}</dd></div>
                <div><dt className="inline font-semibold text-profit">Something to try: </dt><dd className="inline text-ink-soft">{p.suggestion}</dd></div>
              </dl>
              <details className="mt-3 text-[13px]">
                <summary className="cursor-pointer text-muted hover:text-ink">Evidence and rule</summary>
                <p className="mt-2 text-muted">{p.rule}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {p.evidenceTradeIds.map((id) => (
                    <li key={id}>
                      <button type="button" className="num rounded border border-line px-1.5 py-0.5 text-[12px] hover:border-accent" onClick={() => openTrade(id)}>#{id}</button>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="mt-4 flex flex-wrap gap-2">
                {settings?.jarvis.enabled && <Button size="sm" onClick={() => askJarvis(`Help me think through the pattern "${p.title}". Is it a problem for me?`)}>Discuss with Jarvis</Button>}
                <Button size="sm" variant="ghost" onClick={() => void dismiss(p)}>Doesn&apos;t apply to me — hide</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hidden.length > 0 && (
        <p className="mt-6 text-[13px] text-muted">
          {hidden.length} hidden pattern{hidden.length > 1 ? "s" : ""}.{" "}
          <button type="button" className="text-accent underline" onClick={() => void saveSettings({ dismissedPatterns: [] })}>Show again</button>
        </p>
      )}
      <p className="mt-6 text-[12px] text-muted">
        Patterns aren&apos;t a psychological assessment. Turn them off any time in <Link href="/settings#jarvis" className="underline">Settings</Link>.
      </p>
    </>
  );
}
