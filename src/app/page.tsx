"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import type { Analytics } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { dateTime } from "@/lib/client/format";
import { zoneInstant, zoneParts } from "@/lib/domain/zone";
import { useFetch } from "@/lib/client/use-fetch";
import type { Trade } from "@/lib/domain/types";
import { ChallengeAlerts } from "@/components/progress/ChallengeAlerts";
import { CumulativeCard, DailyCard, KpiRow, MonthCalendar, ScoreCard, TradesCard, type LivePosition } from "@/components/dashboard/Board";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { TopControls } from "@/components/dashboard/TopControls";
import { DashboardSkeleton } from "@/components/tape/Skeletons";
import { ICONS, Icon } from "@/components/Dropdown";
import { Suspended } from "@/components/Suspended";
import { Button, EmptyState, Notice, cx } from "@/components/ui";
import type { ConnectionStatus } from "@/lib/server/repo/mt5";

export default function DashboardPage() {
  return (
    <Suspended>
      <Dashboard />
    </Suspended>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
function todayKey(tz?: string) {
  const d = zoneParts(Date.now(), tz);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}
const everyMinute = (cb: () => void) => {
  const id = setInterval(cb, 60_000);
  return () => clearInterval(id);
};
/** Today's date in the chosen zone, rechecked each minute, so a dashboard left open overnight moves to the new day. */
function useToday(tz?: string) {
  return useSyncExternalStore(everyMinute, () => todayKey(tz), () => todayKey(tz));
}

function sevenDaysAgo(tz?: string) {
  const d = zoneParts(Date.now(), tz);
  return new Date(zoneInstant(d.year, d.month, d.day - 6, 0, 0, tz)).toISOString();
}

interface Live {
  lastImport: { at: string; filename: string } | null;
  lastSync: string | null;
  connections: ConnectionStatus[];
  positions: LivePosition[];
}

const smallLink = "inline-flex h-8 items-center rounded-control border border-line bg-surface px-3 text-[13px] hover:bg-raised";

function StatusRow({ live, filters, editing, setEditing, today, dayHref }: { live: Live | undefined; filters: ReturnType<typeof useUrlFilters>; editing: boolean; setEditing: (v: boolean) => void; today: string; dayHref: (k: string) => string }) {
  const { toast, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const accountId = Number(filters.get("accountId")) || null;
  const targets = (live?.connections ?? []).filter((c) => !accountId || c.accountId === accountId);
  const resync = async () => {
    setBusy(true);
    const results = await Promise.allSettled(targets.map((c) => api("/api/mt5/sync", { method: "POST", json: { accountId: c.accountId } })));
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length) toast({ message: `Resync failed: ${failed[0].reason instanceof Error ? failed[0].reason.message : "MT5 didn't answer."}`, tone: "error" });
    else toast({ message: `Synced ${targets.length} MT5 ${targets.length === 1 ? "account" : "accounts"}.`, tone: "success" });
    await refresh();
  };
  const last = [live?.lastImport?.at, live?.lastSync].filter(Boolean).sort().at(-1) as string | undefined;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="status-row">
      <p className="text-[12.5px] text-ink-soft">
        <span className="font-semibold text-ink">Last import:</span>{" "}
        <span data-testid="last-import">{live === undefined ? "…" : last ? dateTime(last) : "never"}</span>
        {live?.lastSync && last === live.lastSync && <span className="text-muted"> (MT5 sync)</span>}{" "}
        {targets.length > 0 ? (
          <button type="button" onClick={() => void resync()} disabled={busy} className="ml-1 text-accent italic underline underline-offset-2 hover:text-accent/80 disabled:opacity-60">{busy ? "Syncing…" : "Resync"}</button>
        ) : (
          <Link href="/journal?import=1" className="ml-1 text-accent italic underline underline-offset-2">Import trades</Link>
        )}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Link href={dayHref(today)} className="inline-flex h-[34px] items-center gap-2 rounded-control bg-accent px-3.5 text-[13px] font-semibold text-accent-ink shadow-[0_10px_22px_-12px_var(--accent)] hover:bg-accent/90" data-testid="start-my-day">
          <Icon d={ICONS.rocket} size={15} />
          Start my day
        </Link>
        <button type="button" aria-pressed={editing} onClick={() => setEditing(!editing)} aria-label="Dashboard settings: show, hide and reorder widgets" title="Dashboard settings" className={cx("grid size-[34px] place-items-center rounded-control border border-line bg-surface text-ink-soft hover:bg-raised", editing && "border-accent text-accent")}>
          <Icon d={ICONS.dashboard} size={16} />
        </button>
      </div>
    </div>
  );
}

function Dashboard() {
  const { settings, saveSettings, editTrade, openTrade, askJarvis, refresh, toast, accounts } = useApp();
  const filters = useUrlFilters();
  const search = useSearchParams().toString();
  const [editing, setEditing] = useState(false);
  const tz = settings?.timeZone || undefined;
  const today = useToday(tz);
  const week = useMemo(() => sevenDaysAgo(tz), [tz]);
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery()}`);
  const recent = useFetch<{ trades: Trade[] }>(data ? `/api/trades?${filters.apiQuery({ extra: { pageSize: "10", currency: data.currency, sort: "closedAt", dir: "desc", closedOnly: "1" } })}` : null);
  const live = useFetch<Live>(`/api/dashboard/live?${filters.apiQuery({ dates: false })}`);
  const unanswered = useFetch<{ total: number }>(settings?.jarvis.reflectionPrompts ? `/api/trades?plan=unanswered&from=${encodeURIComponent(week)}&pageSize=1` : null);

  const dayHref = (key: string) => {
    const next = new URLSearchParams(search);
    next.set("date", key);
    return `/day?${next}`;
  };

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
  // A sample-only journal still counts as started: the filters offer to show it.
  const fresh = none && !filters.active && !data.sampleHidden;
  const positions = live.data?.positions.filter((p) => !p.currency || p.currency === data.currency || filters.get("accountId")) ?? null;
  const otherCurrency = (live.data?.positions.length ?? 0) - (positions?.length ?? 0);

  return (
    <div className={loading ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <h1 className="sr-only">Dashboard</h1>
      <TopControls filters={filters} currency={data.currency} currencies={data.currencies} unitNote={data.unitNote} />
      <StatusRow live={live.data} filters={filters} editing={editing} setEditing={setEditing} today={today} dayHref={dayHref} />
      <ChallengeAlerts includeSample={filters.get("includeSample") === "1"} />
      {data.unitNote && <p role="note" className="mb-3 text-[13px] text-muted" data-testid="unit-note">{data.unitNote}</p>}
      {data.sampleHidden && (
        <p role="note" className="mb-3 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
          Sample trades are hidden, so what you see here is only your own record.
          <button type="button" className="text-accent underline underline-offset-2" onClick={() => filters.set({ includeSample: "1" })}>Include sample data</button>
        </p>
      )}
      {filters.get("includeSample") === "1" && (
        <p role="note" className="mb-3 flex flex-wrap items-center gap-x-3 text-[13px] text-info">
          These figures include made-up sample trades. They aren&apos;t real results.
          <button type="button" className="underline underline-offset-2" onClick={() => filters.set({ includeSample: null })}>Hide sample data</button>
        </p>
      )}

      {none && filters.active && <EmptyState title="No trades match these filters" body="Widen the date range or clear the filters to see more." action={<Button onClick={filters.clear}>Clear filters</Button>} />}
      {none && !filters.active && data.sampleHidden && <EmptyState title="Only sample trades so far" body="Include the sample data above to explore, or log your own first trade." action={<Button variant="primary" onClick={() => editTrade("new")}>Add a trade</Button>} />}
      {fresh && !settings?.onboardingDismissed && (
        <section className="rounded-panel border border-line bg-glass shadow-card">
          <div className="flex items-start justify-between gap-3 px-card py-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Start your journal</h2>
              <p className="mt-0.5 text-[13px] text-muted">Everything stays on this computer.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void saveSettings({ onboardingDismissed: true })}>Hide</Button>
          </div>
          <ul className="grid divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <li className="p-card">
              <h3 className="font-medium">Log a trade</h3>
              <p className="mt-1 text-[13.5px] text-muted">Enter one by hand: entry, stop, target and how it went.</p>
              <Button className="mt-3" size="sm" variant="primary" onClick={() => editTrade("new")}>Add a trade</Button>
            </li>
            <li className="p-card">
              <h3 className="font-medium">Import or connect</h3>
              <p className="mt-1 text-[13.5px] text-muted">Bring in a broker CSV or Excel file, or link MetaTrader 5.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/journal?import=1" className={smallLink}>Import a file</Link>
                <Link href="/accounts" className={smallLink}>Accounts &amp; MT5</Link>
              </div>
            </li>
            <li className="p-card">
              <h3 className="font-medium">Try it with sample data</h3>
              <p className="mt-1 text-[13.5px] text-muted">Made-up trades, always labelled Sample, removable in Settings.</p>
              <Button className="mt-3" size="sm" onClick={() => void loadSample()}>Load sample journal</Button>
            </li>
          </ul>
        </section>
      )}
      {fresh && settings?.onboardingDismissed && <EmptyState title="No trades yet" body="Add your first trade, import a file, or connect MT5." action={<Button variant="primary" onClick={() => editTrade("new")}>Add a trade</Button>} />}

      {!none && (
        <div className="space-y-[22px]">
          {m.excludedTrades > 0 && (
            <Notice action={<Link href={pendingLink} className="text-[13.5px] font-medium text-ink underline underline-offset-2">Show {m.excludedTrades === 1 ? "that trade" : "those trades"}</Link>}>
              {m.excludedTrades} closed {m.excludedTrades === 1 ? "trade is" : "trades are"} left out of these figures, because a conversion rate to {data.currency} is missing or the fills don&apos;t add up. Enter the rate on the trade to include it.
            </Notice>
          )}
          <KpiRow data={data} display={data.display} search={search} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-[21px] md:grid-cols-2 xl:grid-cols-3">
            <div className="md:col-span-2 xl:col-span-1"><ScoreCard data={data} /></div>
            {/* The chart is drawn by close date, so its zoom filters by close date too. */}
            <CumulativeCard data={data} display={data.display} dayHref={dayHref} brush={(closedFrom, closedTo) => filters.set({ closedFrom, closedTo })} rangeActive={Boolean(filters.get("closedFrom") || filters.get("closedTo"))} clearRange={() => filters.set({ closedFrom: null, closedTo: null })} />
            <DailyCard data={data} display={data.display} dayHref={dayHref} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-[21px] xl:grid-cols-3">
            <div className="flex min-w-0 flex-col">
              <TradesCard recent={recent.data?.trades ?? []} accounts={accounts} positions={positions} openTrade={openTrade} search={search} />
              {otherCurrency > 0 && <p className="mt-1.5 text-[12px] text-muted">{otherCurrency} open {otherCurrency === 1 ? "position is" : "positions are"} in another currency. Pick that currency or account to see {otherCurrency === 1 ? "it" : "them"}.</p>}
            </div>
            <div className="min-w-0 xl:col-span-2">
              <MonthCalendar data={data} display={data.display} dayHref={dayHref} today={today} />
            </div>
          </div>
          <DashboardGrid
            editing={editing}
            ctx={{
              data,
              display: data.display,
              search,
              patterns,
              toAnswer: unanswered.data?.total ?? 0,
              coachEnabled: Boolean(settings?.jarvis.enabled),
              openTrade,
              askJarvis,
            }}
          />
        </div>
      )}
    </div>
  );
}
