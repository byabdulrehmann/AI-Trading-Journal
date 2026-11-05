"use client";

import { useMemo } from "react";
import type { Analytics } from "@/lib/client/analytics";
import { dayKey, dayWindow, fromKey, monthKeyOf, weeksOf } from "@/lib/client/calendar";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { compactMoney, dateTime, money, pct, toneOf } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { addMoney } from "@/lib/domain/engine/position";
import type { PeriodRow } from "@/lib/domain/metrics";
import type { Trade } from "@/lib/domain/types";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { PnlIssue, SideBadge, StatusBadge } from "@/components/journal/badges";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, CardHeader, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";

export default function CalendarPage() {
  return (
    <Suspended>
      <CalendarView />
    </Suspended>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function CalendarView() {
  const filters = useUrlFilters();
  const { editTrade } = useApp();
  const today = useMemo(() => dayKey(new Date()), []);
  // Whole history, because a day's total can't depend on when its trades were opened.
  const { data, error, loading, reload } = useFetch<Analytics>(`/api/analytics?${filters.apiQuery({ dates: false })}`);

  const days = useMemo(() => new Map((data?.periods.day ?? []).map((r) => [r.key, r])), [data]);
  const weeks = useMemo(() => new Map((data?.periods.week ?? []).map((r) => [r.key, r])), [data]);

  const latest = data?.periods.day.at(-1)?.key ?? today;
  const monthKey = /^\d{4}-\d{2}$/.test(filters.get("month")) ? filters.get("month") : latest.slice(0, 7);
  const anchor = fromKey(monthKey);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const selected = filters.get("day");
  const grid = weeksOf(year, month);

  if (error && !data) return <EmptyState title="Couldn't load the calendar" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading the calendar" />;

  const cur = data.currency;
  const inMonth = data.periods.day.filter((r) => r.key.startsWith(monthKey));
  const trades = inMonth.reduce((a, r) => a + r.trades, 0);
  const wins = inMonth.reduce((a, r) => a + r.wins, 0);
  const losses = inMonth.reduce((a, r) => a + r.losses, 0);
  const net = addMoney(inMonth.map((r) => r.pnl));
  const shift = (by: number) => {
    const d = new Date(year, month + by, 1);
    filters.set({ month: monthKeyOf(d), day: null });
  };
  const monthName = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className={cx("transition-opacity", loading && "opacity-70")}>
      <PageHeader title="Calendar" description="Results land on the day a trade closed, in this computer's time zone." actions={<CurrencyPicker currency={cur} currencies={data.currencies} filters={filters} />} />
      <TradeFilters filters={filters} dates={false} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-card py-3">
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M8 2L4 6l4 4" /></svg>
            </Button>
            <h2 className="w-40 text-center text-[15px] font-semibold" aria-live="polite">{monthName}</h2>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 2l4 4-4 4" /></svg>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => filters.set({ month: today.slice(0, 7), day: null })}>This month</Button>
          </div>
          <dl className="num flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Net</dt><dd className={toneOf(net)}>{money(net, cur, true)}</dd></div>
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Trades</dt><dd>{trades}</dd></div>
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Won</dt><dd>{wins}</dd></div>
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Lost</dt><dd>{losses}</dd></div>
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Win rate</dt><dd>{trades ? pct(wins / trades) : "—"}</dd></div>
            <div className="flex gap-1.5"><dt className="font-sans text-muted">Days traded</dt><dd>{inMonth.length}</dd></div>
          </dl>
        </div>

        <div className="p-2 sm:p-3">
          <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[12.5px] text-muted md:grid-cols-[repeat(7,minmax(0,1fr))_6.5rem]" aria-hidden>
            {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
            <div className="hidden md:block">Week</div>
          </div>
          {grid.map((week) => {
            const weekRow = weeks.get(dayKey(week[0]));
            return (
              <div key={dayKey(week[0])} className="mb-1 grid grid-cols-7 gap-1 md:grid-cols-[repeat(7,minmax(0,1fr))_6.5rem]">
                {week.map((d) => {
                  const key = dayKey(d);
                  const r = days.get(key);
                  const outside = d.getMonth() !== month;
                  return (
                    <DayCell key={key} date={d} row={r} outside={outside} isToday={key === today} selected={selected === key} currency={cur} onPick={() => filters.set({ day: selected === key ? null : key })} />
                  );
                })}
                <div className="hidden flex-col items-end justify-center rounded-control bg-sunken px-2 text-right md:flex">
                  {weekRow ? (
                    <>
                      <span className={cx("num text-[13px]", toneOf(weekRow.pnl))}>{compactMoney(weekRow.pnl)}</span>
                      <span className="text-[12px] text-muted">{weekRow.trades} {weekRow.trades === 1 ? "trade" : "trades"}</span>
                    </>
                  ) : (
                    <span className="text-[12px] text-muted">—</span>
                  )}
                </div>
              </div>
            );
          })}
          <ul className="num mt-2 divide-y divide-line text-[13px] md:hidden">
            {grid.map((week, i) => {
              const row = weeks.get(dayKey(week[0]));
              return (
                <li key={i} className="flex justify-between py-1">
                  <span className="font-sans text-muted">Week of {week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span className={row ? toneOf(row.pnl) : "text-muted"}>{row ? money(row.pnl, cur, true) : "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      {data.metrics.totalTrades === 0 && (
        <div className="mt-section">
          <EmptyState title="No trades on the calendar" body={filters.active ? "Clear the filters to see more." : "Log a trade with an exit and its day fills in here."} action={filters.active ? <Button onClick={filters.clear}>Clear filters</Button> : <Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>} />
        </div>
      )}
      {selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) && <DayTrades day={selected} row={days.get(selected)} currency={cur} query={filters.apiQuery} />}
    </div>
  );
}

function DayCell({ date, row, outside, isToday, selected, currency, onPick }: { date: Date; row?: PeriodRow; outside: boolean; isToday: boolean; selected: boolean; currency: string; onPick: () => void }) {
  const tone = row ? (row.pnl > 0 ? "bg-profit-soft" : row.pnl < 0 ? "bg-loss-soft" : "bg-raised") : "bg-sunken/50";
  const longDate = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={row ? `${longDate}: ${money(row.pnl, currency, true)}, ${row.trades} ${row.trades === 1 ? "trade" : "trades"}, ${row.wins} won, ${row.losses} lost` : `${longDate}: no closed trades`}
      className={cx("flex min-h-14 min-w-0 flex-col justify-between rounded-control border p-1 text-left transition-colors sm:min-h-24 sm:p-1.5", tone, outside && "opacity-45", selected ? "border-accent" : "border-transparent hover:border-line-strong")}
    >
      <span className={cx("num text-[12px]", isToday ? "font-medium text-accent" : "text-muted")}>{date.getDate()}</span>
      {row && (
        <span className="min-w-0">
          <span className={cx("num block truncate text-[11.5px] sm:hidden", toneOf(row.pnl))}>{compactMoney(row.pnl)}</span>
          <span className={cx("num hidden truncate text-[13.5px] sm:block", toneOf(row.pnl))}>{money(row.pnl, currency, true)}</span>
          <span className="hidden text-[12px] text-muted sm:block">{row.trades} {row.trades === 1 ? "trade" : "trades"}, {row.wins}W {row.losses}L</span>
        </span>
      )}
    </button>
  );
}

function DayTrades({ day, row, currency, query }: { day: string; row?: PeriodRow; currency: string; query: (o: { dates?: boolean; extra?: Record<string, string> }) => string }) {
  const { openTrade, accounts } = useApp();
  const { start, end } = dayWindow(day);
  const closed = useFetch<{ trades: Trade[]; total: number }>(`/api/trades?${query({ dates: false, extra: { closedFrom: start, closedTo: end, sort: "closedAt", dir: "asc", pageSize: "200", currency } })}`);
  const opened = useFetch<{ trades: Trade[] }>(`/api/trades?${query({ dates: false, extra: { from: start, to: end, outcome: "open", pageSize: "200", currency } })}`);
  const label = fromKey(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const list = [...(closed.data?.trades ?? []), ...(opened.data?.trades ?? [])];
  const curOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency;

  return (
    <Card className="mt-section">
      <CardHeader title={label} subtitle={row ? `${row.trades} closed, ${row.wins} won, ${row.losses} lost` : undefined} action={row && <span className={cx("num text-[14px]", toneOf(row.pnl))}>{money(row.pnl, currency, true)}</span>} />
      {closed.loading && !closed.data ? (
        <div className="p-card"><Spinner /></div>
      ) : list.length === 0 ? (
        <p className="p-card text-[14px] text-muted">No trades closed or opened on this day. Pick a shaded day, or change the filters.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openTrade(t.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-card py-2 text-left hover:bg-raised/50">
                <span className="font-medium">{t.symbol}</span>
                <SideBadge side={t.side} />
                {t.status !== "closed" && <StatusBadge status={t.status} />}
                <span className="num text-[12.5px] text-muted">{dateTime(t.closedAt ?? t.openedAt)}</span>
                <span className={`num ml-auto text-[14px] ${toneOf(t.pnl)}`}>
                  {t.pnlStatus !== "ok" ? <PnlIssue status={t.pnlStatus} /> : t.pnl === null ? <span className="text-muted">Open</span> : money(t.pnl, curOf(t), true)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
