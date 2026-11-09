/** The dashboard's date arithmetic and series, kept pure so the calendar's edge cases are tested in one place. */

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export interface DayCell {
  key: string;
  day: number;
  inMonth: boolean;
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Sunday-first weeks covering a month (1 to 12), spilling into its neighbours. Built from date parts, so DST can't shift a day. */
export function monthGrid(year: number, month: number): DayCell[][] {
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = daysInMonth(year, month);
  const rows = Math.ceil((offset + count) / 7);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const n = r * 7 + c - offset + 1;
      const key = keyOf(year, month, n);
      return { key, day: Number(key.slice(8)), inMonth: n >= 1 && n <= count };
    }),
  );
}

export interface DayResult {
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

const add = (a: number, b: number) => Math.round((a + b) * 100) / 100;

export interface WeekSummary {
  index: number;
  pnl: number;
  /** Days in this row and this month with a closed trade. */
  days: number;
  trades: number;
}

/** One summary per calendar row, counting only that row's days inside the month, as the row is drawn. */
export function weekSummaries(grid: DayCell[][], days: Map<string, DayResult>): WeekSummary[] {
  return grid.map((row, i) => {
    const hit = row.filter((c) => c.inMonth && days.has(c.key)).map((c) => days.get(c.key) as DayResult);
    return { index: i + 1, pnl: hit.reduce((t, d) => add(t, d.pnl), 0), days: hit.length, trades: hit.reduce((t, d) => t + d.trades, 0) };
  });
}

export function monthStats(year: number, month: number, days: Map<string, DayResult>): { pnl: number; days: number; trades: number } {
  const prefix = `${year}-${pad(month)}-`;
  const hit = [...days.entries()].filter(([k]) => k.startsWith(prefix)).map(([, d]) => d);
  return { pnl: hit.reduce((t, d) => add(t, d.pnl), 0), days: hit.length, trades: hit.reduce((t, d) => t + d.trades, 0) };
}

/** "2026-02" moved by whole months. */
export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  return keyOf(y, m + by, 1).slice(0, 7);
}

/** Realized P&L per day with the running total, in day order. Days with no closed trade are not invented. */
export function cumulativeByDay(rows: { key: string; pnl: number }[]): { key: string; pnl: number; cum: number }[] {
  let cum = 0;
  return [...rows].sort((a, b) => a.key.localeCompare(b.key)).map((r) => {
    cum = add(cum, r.pnl);
    return { key: r.key, pnl: r.pnl, cum };
  });
}

/** "$7.06K", "-$18.1K", "$906": three significant figures, for calendar cells and week cards. */
export function shortMoney(n: number, symbol: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1000) return `${sign}${symbol}${abs < 100 && abs % 1 ? abs.toFixed(2) : Math.round(abs)}`;
  const [v, unit] = abs >= 1e6 ? [abs / 1e6, "M"] : [abs / 1e3, "K"];
  return `${sign}${symbol}${Number(v.toPrecision(3))}${unit}`;
}
