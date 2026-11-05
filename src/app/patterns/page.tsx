"use client";

import Link from "next/link";
import { useState } from "react";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { money, toneOf } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { PATTERN_RULES, type PatternFinding } from "@/lib/domain/patterns";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function PatternsPage() {
  return (
    <Suspended>
      <Patterns />
    </Suspended>
  );
}

function Patterns() {
  const { settings, saveSettings, openTrade, askJarvis, toast } = useApp();
  const filters = useUrlFilters();
  const { data, error, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);
  const [showRules, setShowRules] = useState(false);

  if (settings && !settings.jarvis.behaviouralInsights)
    return (
      <>
        <PageHeader title="Patterns" />
        <EmptyState
          title="Behavioural insights are off"
          body="You turned off pattern detection. Nothing is analysed or shown here, and the AI Coach doesn't receive patterns."
          action={<Button onClick={() => void saveSettings({ jarvis: { behaviouralInsights: true } })}>Turn back on</Button>}
        />
      </>
    );
  if (error && !data) return <EmptyState title="Couldn't load patterns" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Checking your records" />;

  const cur = data.currency;
  const dismissed = settings?.dismissedPatterns ?? [];
  const active = data.patterns.filter((p) => !dismissed.includes(p.id));
  const hidden = data.patterns.filter((p) => dismissed.includes(p.id));
  const totalCost = active.reduce((a, p) => a + (p.cost !== null && p.cost < 0 ? p.cost : 0), 0);
  const hasTrades = data.metrics.totalTrades > 0;

  const dismiss = async (p: PatternFinding) => {
    await saveSettings({ dismissedPatterns: [...dismissed, p.id] });
    toast({ message: `Hidden "${p.title}". The AI Coach won't mention it either.`, action: { label: "Undo", run: () => void saveSettings({ dismissedPatterns: dismissed }) } });
  };

  return (
    <>
      <PageHeader
        title="Patterns"
        description="Rule-based checks over your records. Each one shows the trades behind it. They describe what happened, not why."
        actions={
          <>
            <CurrencyPicker currency={cur} currencies={data.currencies} filters={filters} />
            <Button variant="ghost" onClick={() => setShowRules((s) => !s)} aria-expanded={showRules}>{showRules ? "Hide the rules" : "How patterns are detected"}</Button>
          </>
        }
      />
      <TradeFilters filters={filters} />

      {showRules && (
        <section aria-label="The rules" className="mb-section border-t border-line py-3">
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {Object.entries(PATTERN_RULES).map(([id, r]) => (
              <li key={id} className="border-b border-line py-2 text-[13.5px]">
                <p className="font-medium text-ink">{r.title}</p>
                <p className="mt-0.5 text-ink-soft">{r.rule}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">Needs at least {r.minSample}.</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active.length > 0 && totalCost < 0 && (
        <section aria-label="Combined P&L" className="mb-section flex flex-wrap items-end gap-x-8 gap-y-2 border-t border-line pt-3">
          <div>
            <p className={`figure ${toneOf(totalCost)}`}>{money(totalCost, cur, true)}</p>
            <p className="mt-1 text-[13px] text-muted">Combined P&amp;L of the trades behind these patterns</p>
          </div>
          <p className="max-w-md text-[13px] text-muted">Patterns can share trades, so this is a rough size of what&apos;s at stake, not a precise cost.</p>
        </section>
      )}

      {active.length === 0 ? (
        <EmptyState
          title={hasTrades ? "No patterns stand out" : "No trades to check yet"}
          body={hasTrades ? "None of the rules fire on these records. Keep recording stops, emotions and plan answers: most rules need a few weeks of trades." : "Log or import trades, or include the sample data above, and patterns appear here."}
          action={filters.active ? <Button onClick={filters.clear}>Clear filters</Button> : undefined}
        />
      ) : (
        <ol className="border-b border-line">
          {active.map((p) => (
            <li key={p.id} className="grid gap-x-8 gap-y-2 border-t border-line py-4 md:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="text-[16px] font-medium">{p.title}</h2>
                <p className="mt-1 text-[12.5px] text-muted">{p.confidence[0].toUpperCase() + p.confidence.slice(1)} confidence, <span className="num">{p.occurrences}</span> trades</p>
                {p.cost !== null && <p className={`num mt-2 text-[18px] ${toneOf(p.cost)}`}>{money(p.cost, cur, true)}</p>}
              </div>
              <div className="min-w-0">
                <dl className="max-w-3xl space-y-1.5 text-[14px]">
                  <div><dt className="inline font-medium text-ink">Recorded: </dt><dd className="inline text-ink-soft">{p.observation}</dd></div>
                  <div><dt className="inline font-medium text-ink">Possible reading: </dt><dd className="inline text-ink-soft">{p.interpretation}</dd></div>
                  <div><dt className="inline font-medium text-ink">Something to try: </dt><dd className="inline text-ink-soft">{p.suggestion}</dd></div>
                </dl>
                <details className="mt-3 text-[13px]">
                  <summary className="cursor-pointer text-muted hover:text-ink">Evidence and rule</summary>
                  <p className="mt-2 text-muted">{p.rule}</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.evidenceTradeIds.map((id) => (
                      <li key={id}>
                        <button type="button" className="num border border-line-strong px-1.5 py-0.5 text-[12px] hover:bg-raised pointer-coarse:px-3 pointer-coarse:py-3" onClick={() => openTrade(id)}>#{id}</button>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {settings?.jarvis.enabled && <Button size="sm" onClick={() => askJarvis(`Help me think through the pattern "${p.title}". Is it a problem for me?`)}>Discuss with the AI Coach</Button>}
                  <Button size="sm" variant="ghost" onClick={() => void dismiss(p)}>Doesn&apos;t apply to me, hide</Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {hidden.length > 0 && (
        <p className="mt-5 text-[13px] text-muted">
          <span className="num">{hidden.length}</span> hidden pattern{hidden.length > 1 ? "s" : ""}.{" "}
          <button type="button" className="text-ink underline underline-offset-2" onClick={() => void saveSettings({ dismissedPatterns: [] })}>Show again</button>
        </p>
      )}
      <p className="mt-5 text-[12.5px] text-muted">
        Patterns aren&apos;t a psychological assessment. Turn them off any time in <Link href="/settings#jarvis" className="underline">Settings</Link>.
      </p>
    </>
  );
}
