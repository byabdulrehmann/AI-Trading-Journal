"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const GRID = "grid grid-cols-7 md:grid-cols-[repeat(7,minmax(0,1fr))_5.5rem]";

function addDays(key: string, by: number) {
  const d = fromKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + by));
}

/** The same day of the month, or the last day when that month is shorter. */
function addMonths(key: string, by: number) {
  const d = fromKey(key);
  const last = new Date(d.getFullYear(), d.getMonth() + by + 1, 0).getDate();
  return dayKey(new Date(d.getFullYear(), d.getMonth() + by, Math.min(d.getDate(), last)));
}

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

  // The one day in the grid's tab order. Arrow keys move it, and focus follows once the month it lands in has drawn.
  const [cursor, setCursor] = useState<string | null>(null);
  const moved = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const keys = grid.flat().map(dayKey);
  const fallback = keys.includes(selected) ? selected : keys.includes(today) ? today : `${monthKey}-01`;
  const current = cursor && keys.includes(cursor) ? cursor : fallback;

  useEffect(() => {
    // Waits for the month in the URL to catch up, so focus never lands on the fallback day of the old grid.
    if (moved.current !== monthKey || cursor !== current) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${current}"]`)?.focus();
    moved.current = null;
  }, [current, cursor, monthKey]);

  if (error && !data) return <EmptyState title="Couldn't load the calendar" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data)
    return (
      <div aria-busy>
        <Spinner label="Loading the calendar" />
        <div className="mt-4 h-96 bg-sunken" aria-hidden />
      </div>
    );

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

  const moveTo = (key: string) => {
    setCursor(key);
    if (keys.includes(key)) {
      gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus();
      return;
    }
    moved.current = key.slice(0, 7);
    filters.set({ month: key.slice(0, 7), day: null });
  };
  const onKey = (e: React.KeyboardEvent, key: string) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (by) {
      e.preventDefault();
      moveTo(addDays(key, by));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const next = addMonths(key, e.key === "PageUp" ? -1 : 1);
      moved.current = next.slice(0, 7);
      setCursor(next);
      filters.set({ month: next.slice(0, 7), day: null });
    }
  };

  return (
    <div className={cx("transition-opacity", loading && "opacity-70")}>
      <PageHeader title="Calendar" description="Results land on the day a trade closed, in this computer's time zone." actions={<CurrencyPicker currency={cur} currencies={data.currencies} filters={filters} />} />
      <TradeFilters filters={filters} dates={false} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-label="Month grid" className="border-t border-line">
          <div className="flex flex-wrap items-center gap-1 py-2">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M8 2L4 6l4 4" /></svg>
            </Button>
            <h2 className="w-40 text-center text-[15px] font-medium" aria-live="polite">{monthName}</h2>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} aria-label="Next month">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M4 2l4 4-4 4" /></svg>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => filters.set({ month: today.slice(0, 7), day: null })}>This month</Button>
            <p className="ml-auto hidden text-[12.5px] text-muted lg:block">Arrow keys move, Enter selects, <kbd>PgUp</kbd> and <kbd>PgDn</kbd> change month.</p>
          </div>

          <div ref={gridRef} role="grid" aria-label={monthName} className="border-b border-line">
            <div role="row" className={cx(GRID, "border-y border-line text-[12.5px] text-muted")}>
              {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="border-l border-line px-1.5 py-1 first:border-l-0">{d}</div>)}
              <div role="columnheader" className="hidden border-l border-line px-1.5 py-1 text-right md:block">Week</div>
            </div>
            {grid.map((week) => {
              const weekRow = weeks.get(dayKey(week[0]));
              return (
                <div key={dayKey(week[0])} role="row" className={cx(GRID, "border-b border-line last:border-b-0")}>
                  {week.map((d) => {
                    const key = dayKey(d);
                    return (
                      <DayCell
                        key={key}
                        date={d}
                        dayId={key}
                        row={days.get(key)}
                        outside={d.getMonth() !== month}
                        isToday={key === today}
                        selected={selected === key}
                        tabStop={current === key}
                        currency={cur}
                        onPick={() => {
                          setCursor(key);
                          filters.set({ day: selected === key ? null : key });
                        }}
                        onKeyDown={(e) => onKey(e, key)}
                      />
                    );
                  })}
                  <div role="gridcell" className="hidden flex-col items-end justify-center border-l border-line bg-surface px-1.5 text-right md:flex">
                    {weekRow ? (
                      <>
                        <span className={cx("num text-[13px]", toneOf(weekRow.pnl))}>{compactMoney(weekRow.pnl)}</span>
                        <span className="text-[12px] text-muted"><span className="num">{weekRow.trades}</span> {weekRow.trades === 1 ? "trade" : "trades"}</span>
                      </>
                    ) : (
                      <span className="text-[12px] text-muted">No trades</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="mt-2 divide-y divide-line border-b border-line text-[13px] md:hidden">
            {grid.map((week) => {
              const row = weeks.get(dayKey(week[0]));
              return (
                <li key={dayKey(week[0])} className="flex justify-between gap-3 py-1">
                  <span className="text-muted">Week of <span className="num">{week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></span>
                  <span className={cx("num", row ? toneOf(row.pnl) : "text-muted")}>{row ? money(row.pnl, cur, true) : "No trades"}</span>
                </li>
              );
            })}
          </ul>

          {data.metrics.totalTrades === 0 && (
            <div className="mt-section">
              <EmptyState title="No trades on the calendar" body={filters.active ? "Clear the filters to see more." : "Log a trade with an exit and its day fills in here."} action={filters.active ? <Button onClick={filters.clear}>Clear filters</Button> : <Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>} />
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-5" aria-label="Month summary and selected day">
          <section className="border-t border-line">
            <h2 className="py-3 text-[15px] font-medium text-ink">{monthName}</h2>
            <p className={cx("figure", toneOf(net))}>{money(net, cur, true)}</p>
            <p className="mt-0.5 text-[12.5px] text-muted">Net</p>
            <dl className="mt-3 grid grid-cols-2 text-[13.5px] sm:grid-cols-4 xl:grid-cols-2">
              {[
                ["Trades", String(trades)],
                ["Won", String(wins)],
                ["Lost", String(losses)],
                ["Days traded", String(inMonth.length)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-2 border-t border-line py-1.5 pr-3">
                  <dt className="text-muted">{label}</dt>
                  <dd className="num">{value}</dd>
                </div>
              ))}
              <div className="col-span-2 flex items-baseline justify-between gap-2 border-t border-line py-1.5 pr-3">
                <dt className="text-muted">Win rate</dt>
                <dd className={trades ? "num" : "text-muted"}>{trades ? pct(wins / trades) : "No trades"}</dd>
              </div>
            </dl>
          </section>
          {selected && /^\d{4}-\d{2}-\d{2}$/.test(selected) ? (
            <DayTrades day={selected} row={days.get(selected)} currency={cur} query={filters.apiQuery} />
          ) : (
            <p className="border-t border-line pt-3 text-[13.5px] text-muted">Pick a day to list its trades here.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function DayCell({ date, dayId, row, outside, isToday, selected, tabStop, currency, onPick, onKeyDown }: { date: Date; dayId: string; row?: PeriodRow; outside: boolean; isToday: boolean; selected: boolean; tabStop: boolean; currency: string; onPick: () => void; onKeyDown: (e: React.KeyboardEvent) => void }) {
  const tone = row ? (row.pnl > 0 ? "bg-profit-soft" : row.pnl < 0 ? "bg-loss-soft" : "bg-raised") : "";
  const longDate = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div role="gridcell" aria-selected={selected} className="min-w-0 border-l border-line first:border-l-0">
      <button
        type="button"
        data-day={dayId}
        tabIndex={tabStop ? 0 : -1}
        onClick={onPick}
        onKeyDown={onKeyDown}
        aria-pressed={selected}
        aria-label={row ? `${longDate}: ${money(row.pnl, currency, true)}, ${row.trades} ${row.trades === 1 ? "trade" : "trades"}, ${row.wins} won, ${row.losses} lost` : `${longDate}: no closed trades`}
        className={cx(
          "relative flex h-full min-h-[5.25rem] w-full min-w-0 flex-col justify-between p-1 text-left outline-offset-[-2px] transition-colors hover:bg-raised sm:min-h-[6rem] sm:p-1.5",
          tone,
          outside && "opacity-45",
          selected && "shadow-[inset_0_0_0_2px_var(--accent)]",
        )}
      >
        <span className={cx("num text-[12px]", isToday ? "font-medium text-ink underline underline-offset-2" : "text-muted")}>
          {date.getDate()}
          {isToday && <span className="sr-only"> today</span>}
        </span>
        {row && (
          <span className="min-w-0">
            <span className={cx("num block truncate text-[11.5px] sm:hidden", toneOf(row.pnl))}>{compactMoney(row.pnl)}</span>
            <span className={cx("num hidden truncate text-[13.5px] sm:block", toneOf(row.pnl))}>{money(row.pnl, currency, true)}</span>
            <span className="num block text-[11px] leading-tight text-muted sm:hidden">{row.trades}t</span>
            <span className="num block text-[11px] leading-tight whitespace-nowrap text-muted sm:hidden">{row.wins}W {row.losses}L</span>
            <span className="hidden truncate text-[12px] text-muted sm:block"><span className="num">{row.trades}</span> {row.trades === 1 ? "trade" : "trades"}, <span className="num">{row.wins}W {row.losses}L</span></span>
          </span>
        )}
      </button>
    </div>
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
    <Card aria-live="polite" data-testid="day-trades">
      <CardHeader title={label} subtitle={<>{row ? <>{row.trades} closed, {row.wins} won, {row.losses} lost. </> : null}Times are local time.</>} action={row && <span className={cx("num text-[14px]", toneOf(row.pnl))}>{money(row.pnl, currency, true)}</span>} />
      {closed.loading && !closed.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-[14px] text-muted">No trades closed or opened on this day. Pick a shaded day, or change the filters.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openTrade(t.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-left hover:bg-raised">
                <span className="font-medium">{t.symbol}</span>
                <SideBadge side={t.side} />
                {t.status !== "closed" && <StatusBadge status={t.status} />}
                <span className={`num ml-auto text-[14px] ${toneOf(t.pnl)}`}>
                  {t.pnlStatus !== "ok" ? <PnlIssue status={t.pnlStatus} /> : t.pnl === null ? <span className="text-muted">Open</span> : money(t.pnl, curOf(t), true)}
                </span>
                <span className="num w-full text-[12.5px] text-muted">{dateTime(t.closedAt ?? t.openedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
