"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { Analytics } from "@/lib/client/analytics";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dayKey, dayWindow, fromKey } from "@/lib/client/calendar";
import { useUrlFilters } from "@/lib/client/filters";
import { money, pct, profitFactorText, timeOnly, toneOf, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { METRIC_DEFINITIONS as D } from "@/lib/domain/metrics";
import type { DailyEntry } from "@/lib/domain/types";
import { zoneDateKey } from "@/lib/domain/zone";
import { LineChart } from "@/components/charts";
import { DayTrades } from "@/components/journal/DayTrades";
import { Rating } from "@/components/journal/TradeForm";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Metric, PageHeader, Spinner, cx, inputClass } from "@/components/ui";

export default function DayPage() {
  return (
    <Suspended>
      <DayView />
    </Suspended>
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_LENGTH = 30;
const todayIn = (tz?: string) => zoneDateKey(Date.now(), tz);
const shift = (key: string, by: number) => {
  const d = fromKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + by));
};

/** Saves when focus leaves a box or the rating changes. Only what changed since the last save goes out. */
function DayNotes({ date, entry, includeSample, onSaved }: { date: string; entry: DailyEntry | null; includeSample: boolean; onSaved: () => void }) {
  const { settings, toast } = useApp();
  const [plan, setPlan] = useState(entry?.plan ?? "");
  const [recap, setRecap] = useState(entry?.recap ?? "");
  const [rating, setRating] = useState(entry?.rating === null || entry?.rating === undefined ? "" : String(entry.rating));
  const [status, setStatus] = useState("");
  const saved = useRef({ plan, recap, rating });
  const templates = settings?.journalTemplates;

  const save = async (next: { plan: string; recap: string; rating: string }) => {
    const was = saved.current;
    if (next.plan === was.plan && next.recap === was.recap && next.rating === was.rating) return;
    setStatus("Saving");
    try {
      await api("/api/daily", { method: "PUT", json: { date, plan: next.plan, recap: next.recap, rating: next.rating ? Number(next.rating) : null } });
      saved.current = next;
      setStatus("Saved");
      onSaved();
    } catch (e) {
      setStatus("Not saved");
      toast({ message: e instanceof Error ? e.message : "Couldn't save this day.", tone: "error" });
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your notes"
        subtitle="Stored for this day, on this computer."
        action={
          <span className="flex items-center gap-2">
            {entry?.isSample && <Badge tone="info">Sample</Badge>}
            <span role="status" data-testid="day-status" className="text-[13px] text-muted">{status}</span>
          </span>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <div>
          <Field label="Pre-market plan">
            {(p) => <textarea {...p} rows={8} maxLength={8000} className={cx(inputClass, "h-auto py-1.5")} value={plan} onChange={(e) => setPlan(e.target.value)} onBlur={() => void save({ plan, recap, rating })} />}
          </Field>
          {!plan && templates?.plan && <Button size="sm" variant="ghost" className="mt-1 max-sm:h-11" onClick={() => setPlan(templates.plan)}>Start from your plan template</Button>}
        </div>
        <div>
          <Field label="End of day recap">
            {(p) => <textarea {...p} rows={8} maxLength={8000} className={cx(inputClass, "h-auto py-1.5")} value={recap} onChange={(e) => setRecap(e.target.value)} onBlur={() => void save({ plan, recap, rating })} />}
          </Field>
          {!recap && templates?.recap && <Button size="sm" variant="ghost" className="mt-1 max-sm:h-11" onClick={() => setRecap(templates.recap)}>Start from your recap template</Button>}
        </div>
      </div>
      <div className="mt-3 max-w-xs">
        <Rating label="Rate this day" value={rating} onChange={(v) => { setRating(v); void save({ plan, recap, rating: v }); }} />
      </div>
      {includeSample && entry?.isSample && <p className="mt-2 text-[12.5px] text-muted">Made-up sample notes. Editing them makes this day yours, and it stays when sample data is removed.</p>}
    </Card>
  );
}

function DayView() {
  const filters = useUrlFilters();
  const router = useRouter();
  const search = useSearchParams();
  const { settings, editTrade, openTrade } = useApp();
  const tz = settings?.timeZone || undefined;
  const today = useMemo(() => todayIn(tz), [tz]);
  const asked = search.get("date") ?? "";
  const date = DATE.test(asked) && !Number.isNaN(fromKey(asked).getTime()) ? asked : today;
  const includeSample = search.get("includeSample") === "1";
  const { start, end } = dayWindow(date);

  const day = useFetch<Analytics>(`/api/analytics?${filters.apiQuery({ dates: false, extra: { closedFrom: start, closedTo: end } })}`);
  const all = useFetch<Analytics>(`/api/analytics?${filters.apiQuery({ dates: false })}`);
  const sampleQuery = includeSample ? "&includeSample=1" : "";
  const entry = useFetch<{ entry: DailyEntry | null }>(`/api/daily?date=${date}${sampleQuery}`);
  const notes = useFetch<{ days: DailyEntry[] }>(`/api/daily?${sampleQuery.slice(1)}`);

  const goTo = (d: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("date", d);
    router.push(`/day?${next}`, { scroll: false });
  };
  const linkTo = (d: string) => {
    const next = new URLSearchParams(search.toString());
    next.set("date", d);
    return `/day?${next}`;
  };

  const results = useMemo(() => new Map((all.data?.periods.day ?? []).map((r) => [r.key, r])), [all.data]);
  const noted = useMemo(() => new Map((notes.data?.days ?? []).map((d) => [d.date, d])), [notes.data]);
  const listed = useMemo(() => [...new Set([...results.keys(), ...noted.keys()])].sort().reverse().slice(0, LIST_LENGTH), [results, noted]);

  const data = day.data;
  const m = data?.metrics;
  const display = data?.display ?? "USD";
  const fmt = (n: number | null | undefined) => money(n, display, true);

  return (
    <div>
      <PageHeader title="Daily journal" description={`Plan the day, review it, and see how it went. Results land on the day a trade closed, ${zoneName()}.`} />
      <TradeFilters filters={filters} dates={false} units unitNote={data?.unitNote} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" className="max-sm:h-11" onClick={() => goTo(shift(date, -1))}>Previous day</Button>
        <input type="date" aria-label="Date" className={cx(inputClass, "num h-8 w-40! text-[13px] max-sm:h-11")} value={date} onChange={(e) => e.target.value && goTo(e.target.value)} />
        <Button size="sm" className="max-sm:h-11" onClick={() => goTo(shift(date, 1))}>Next day</Button>
        {date !== today && <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => goTo(today)}>Today</Button>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {day.error && !data ? (
            <EmptyState title="Couldn't load this day" body={day.error} action={<Button onClick={day.reload}>Try again</Button>} />
          ) : !data || !m ? (
            <Spinner label="Working out the day" />
          ) : m.closedTrades === 0 ? (
            <Card data-testid="day-empty">
              <CardHeader title="No closed trades on this day" subtitle="You can still write your plan and recap." action={<Button size="sm" onClick={() => editTrade("new")}>Log a trade</Button>} />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="How the day went" subtitle={`Cumulative net across the day's closed trades, ${zoneName()}. A point opens its trade.`} />
                <p className={cx("figure num", toneOf(m.netPnl))} data-testid="day-net">{fmt(m.netPnl)}</p>
                <LineChart label="Net P&L through the day" points={data.equity.map((p) => ({ at: p.at, value: p.equity, tradeId: p.tradeId }))} currency={display} onSelect={openTrade} height={180} formatAt={timeOnly} />
              </Card>
              <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-8 sm:grid-cols-2">
                <div>
                  <Metric def={D.closedTrades} value={m.closedTrades} />
                  <Metric def={D.winRate} value={`${m.wins} of ${m.closedTrades}, ${pct(m.winRate)}`} />
                  <Metric def={D.profitFactor} value={profitFactorText(m)} />
                  <Metric def={D.expectancy} value={fmt(m.expectancy)} tone={toneOf(m.expectancy)} />
                </div>
                <div>
                  <Metric def={D.avgWin} value={fmt(m.avgWin)} tone={m.avgWin === null ? undefined : "text-profit"} />
                  <Metric def={D.avgLoss} value={fmt(m.avgLoss)} tone={m.avgLoss === null ? undefined : "text-loss"} />
                  <Metric def={D.maxDrawdown} value={money(-m.maxDrawdown, display)} tone={m.maxDrawdown ? "text-loss" : undefined} />
                  <Metric def={D.totalFees} value={money(m.totalFees, data.currency)} />
                </div>
              </dl>
            </>
          )}

          {entry.error ? (
            <EmptyState title="Couldn't load your notes" body={entry.error} action={<Button onClick={entry.reload}>Try again</Button>} />
          ) : entry.data ? (
            <DayNotes key={`${date}:${includeSample}`} date={date} entry={entry.data.entry} includeSample={includeSample} onSaved={notes.reload} />
          ) : (
            <Spinner label="Loading your notes" />
          )}

          {data && <DayTrades key={date} day={date} row={data.periods.day[0]} currency={display} query={filters.apiQuery} />}
        </div>

        <nav aria-label="Recent days" className="min-w-0 self-start border-t border-line">
          <h2 className="py-3 text-[15px] font-medium text-ink">Recent days</h2>
          {listed.length === 0 ? (
            <p className="text-[13.5px] text-muted">Days with closed trades or notes appear here.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line" data-testid="day-list">
              {listed.map((d) => {
                const row = results.get(d);
                const note = noted.get(d);
                return (
                  <li key={d}>
                    <Link href={linkTo(d)} aria-current={d === date ? "page" : undefined} scroll={false} className={cx("flex items-baseline justify-between gap-3 px-1 py-1.5 text-[13px] hover:bg-raised", d === date && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}>
                      <span className="min-w-0">
                        <span className="num text-ink-soft">{fromKey(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                        {note && <span className="block text-[12px] text-muted">{[note.plan && "Plan", note.recap && "Recap", note.rating && `Rated ${note.rating}`].filter(Boolean).join(", ")}</span>}
                      </span>
                      <span className={cx("num whitespace-nowrap", row ? toneOf(row.pnl) : "text-muted")}>{row ? money(row.pnl, all.data?.display ?? display, true) : "No trades"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </div>
    </div>
  );
}
