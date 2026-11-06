"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { api } from "@/lib/client/api";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { zoneInstant, zoneParts } from "@/lib/domain/zone";
import { useFetch } from "@/lib/client/use-fetch";
import type { Trade } from "@/lib/domain/types";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { DashboardSkeleton } from "@/components/tape/Skeletons";
import { useSymbols } from "@/components/tape/use-symbols";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, CardHeader, EmptyState, Notice } from "@/components/ui";

export default function DashboardPage() {
  return (
    <Suspended>
      <Dashboard />
    </Suspended>
  );
}

function sevenDaysAgo(tz?: string) {
  const d = zoneParts(Date.now(), tz);
  return new Date(zoneInstant(d.year, d.month, d.day - 6, 0, 0, tz)).toISOString();
}

const smallLink = "inline-flex h-8 items-center border border-line-strong px-3 text-[13px] hover:border-muted";

function Dashboard() {
  const { settings, saveSettings, editTrade, openTrade, askJarvis, refresh, toast, accounts } = useApp();
  const filters = useUrlFilters();
  const search = useSearchParams().toString();
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);
  const recent = useFetch<{ trades: Trade[] }>(data ? `/api/trades?${filters.apiQuery({ extra: { pageSize: "8", currency: data.currency } })}` : null);
  const symbols = useSymbols(data && data.equity.length ? filters.apiQuery({ extra: { currency: data.currency } }) : null);
  const tz = useApp().settings?.timeZone || undefined;
  const week = useMemo(() => sevenDaysAgo(tz), [tz]);
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
        <CurrencyPicker currency={data.currency} currencies={data.currencies} filters={filters} />
      </div>
      <TradeFilters filters={filters} units unitNote={data.unitNote} />

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
          {m.excludedTrades > 0 && (
            <Notice action={<Link href={pendingLink} className="text-[13.5px] font-medium text-ink underline underline-offset-2">Show {m.excludedTrades === 1 ? "that trade" : "those trades"}</Link>}>
              {m.excludedTrades} closed {m.excludedTrades === 1 ? "trade is" : "trades are"} left out of these figures, because a conversion rate to {data.currency} is missing or the fills don&apos;t add up. Enter the rate on the trade to include it.
            </Notice>
          )}
          <DashboardGrid
            ctx={{
              data,
              display: data.display,
              search,
              accounts,
              recent: recent.data?.trades ?? [],
              patterns,
              toAnswer,
              coachEnabled: Boolean(settings?.jarvis.enabled),
              symbols,
              rangeActive: Boolean(filters.get("range")),
              openTrade,
              askJarvis,
              brush: (from, to) => filters.set({ range: "custom", from, to }),
              clearRange: () => filters.set({ range: null, from: null, to: null }),
            }}
          />
        </div>
      )}
    </div>
  );
}
