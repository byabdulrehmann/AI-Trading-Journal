"use client";

import { useApp } from "@/lib/client/app-state";
import { dayWindow, fromKey } from "@/lib/client/calendar";
import { dateTime, money, toneOf, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { PeriodRow } from "@/lib/domain/metrics";
import type { Trade } from "@/lib/domain/types";
import { Card, CardHeader, Spinner, cx } from "@/components/ui";
import { PnlIssue, SideBadge, StatusBadge } from "./badges";

/** The trades closed on a day, plus those opened on it and still open. */
export function DayTrades({ day, row, currency, query, action }: { day: string; row?: PeriodRow; currency: string; query: (o: { dates?: boolean; extra?: Record<string, string> }) => string; action?: React.ReactNode }) {
  const { openTrade, accounts } = useApp();
  const { start, end } = dayWindow(day);
  const closed = useFetch<{ trades: Trade[]; total: number }>(`/api/trades?${query({ dates: false, extra: { closedFrom: start, closedTo: end, sort: "closedAt", dir: "asc", pageSize: "200", currency } })}`);
  const opened = useFetch<{ trades: Trade[] }>(`/api/trades?${query({ dates: false, extra: { from: start, to: end, outcome: "open", pageSize: "200", currency } })}`);
  const label = fromKey(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const list = [...(closed.data?.trades ?? []), ...(opened.data?.trades ?? [])];
  const curOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency;

  return (
    <Card aria-live="polite" data-testid="day-trades">
      <CardHeader title={label} subtitle={<>{row ? <>{row.trades} closed, {row.wins} won, {row.losses} lost. </> : null}Times are {zoneName()}.</>} action={row && <span className={cx("num text-[14px]", toneOf(row.pnl))}>{money(row.pnl, currency, true)}</span>} />
      {closed.loading && !closed.data ? (
        <Spinner />
      ) : list.length === 0 ? (
        <p className="text-[14px] text-muted">No trades closed or opened on this day.</p>
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
      {action && <div className="mt-3">{action}</div>}
    </Card>
  );
}
