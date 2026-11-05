"use client";

import { useState } from "react";
import type { BreakdownRow, PeriodRow } from "@/lib/domain/metrics";
import { dateOnly, money, pct, toneOf } from "@/lib/client/format";
import { DataTable, cx } from "./ui";

const W = 720;

/** Which of n evenly spaced items sits under the pointer. One overlay stays fast with thousands of points. */
function indexAt(e: React.MouseEvent<SVGElement>, n: number, left: number, right: number) {
  const box = e.currentTarget.getBoundingClientRect();
  const x = ((e.clientX - box.left) / box.width) * W;
  return Math.max(0, Math.min(n - 1, Math.round(((x - left) / (W - left - right)) * (n - 1))));
}

const slotAt = (e: React.MouseEvent<SVGElement>, n: number) => {
  const box = e.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n)));
};

const Tip = ({ children }: { children: React.ReactNode }) => (
  <figcaption className="num pointer-events-none absolute top-0 right-0 rounded-control border border-line bg-raised px-2 py-1 text-[12px]">{children}</figcaption>
);

export interface LinePoint {
  at: string;
  value: number;
  tradeId?: number;
}

/** Equity or drawdown over closed trades. Hover for a value; click opens the trade when onSelect is given. */
export function LineChart({ points, currency, label, onSelect, tone, height = 220 }: { points: LinePoint[]; currency: string; label: string; onSelect?: (tradeId: number) => void; tone?: "profit" | "loss"; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const last = points.at(-1)?.value ?? 0;
  const x = (i: number) => pad.l + (points.length > 1 ? i / (points.length - 1) : 0.5) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const color = tone ?? (last >= 0 ? "profit" : "loss");
  const h = hover !== null ? points[hover] : null;

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${label}: ${points.length} closed trades, ending at ${money(last, currency, true)}, ranging from ${money(min, currency)} to ${money(max, currency)}.`}
        onMouseMove={(e) => setHover(indexAt(e, points.length, pad.l, pad.r))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const id = points[indexAt(e, points.length, pad.l, pad.r)]?.tradeId;
          if (onSelect && id) onSelect(id);
        }}
        style={{ cursor: onSelect ? "pointer" : undefined }}
      >
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="2 4" />
        {points.length > 1 && <path d={`${path}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={`var(--${color}-soft)`} />}
        <path d={path} fill="none" stroke={`var(--${color})`} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.length === 1 && <circle cx={x(0)} cy={y(points[0].value)} r="3" fill={`var(--${color})`} />}
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" />
            <circle cx={x(hover)} cy={y(h.value)} r="3.5" fill="var(--ink)" />
          </>
        )}
        <text x={pad.l} y={height - 6} fontSize="11" fill="var(--muted)">{points[0] ? dateOnly(points[0].at) : ""}</text>
        <text x={W - pad.r} y={height - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{points.length > 1 ? dateOnly(points.at(-1)!.at) : ""}</text>
      </svg>
      {h && <Tip>{dateOnly(h.at)} {money(h.value, currency, true)}</Tip>}
    </figure>
  );
}

export interface Bar {
  label: string;
  value: number;
  detail?: string;
}

/** Signed bars around a zero line, with the numbers also available as a table. */
export function BarChart({ bars, label, format, height = 200, summary }: { bars: Bar[]; label: string; format: (n: number) => string; height?: number; summary: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { t: 10, b: 22 };
  const min = Math.min(0, ...bars.map((b) => b.value));
  const max = Math.max(0, ...bars.map((b) => b.value));
  const span = max - min || 1;
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
  const step = W / Math.max(1, bars.length);
  const w = Math.min(48, Math.max(1, step * 0.72));
  const h = hover !== null ? bars[hover] : null;
  return (
    <div>
      <figure className="relative m-0">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${label}: ${bars.length} bars, from ${format(min)} to ${format(max)}.`}
          onMouseMove={(e) => setHover(slotAt(e, bars.length))}
          onMouseLeave={() => setHover(null)}
        >
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
          {bars.map((b, i) => (
            <rect
              key={b.label}
              x={i * step + (step - w) / 2}
              y={Math.min(y(b.value), y(0))}
              width={w}
              height={Math.max(1, Math.abs(y(b.value) - y(0)))}
              rx={1}
              fill={b.value >= 0 ? "var(--profit)" : "var(--loss)"}
              opacity={hover === null || hover === i ? 1 : 0.45}
            />
          ))}
          <text x={0} y={height - 6} fontSize="11" fill="var(--muted)">{bars[0]?.label}</text>
          <text x={W} y={height - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{bars.length > 1 ? bars.at(-1)!.label : ""}</text>
        </svg>
        {h && <Tip>{h.label} {format(h.value)} {h.detail}</Tip>}
      </figure>
      <DataTable summary={summary}>
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-line">
            {bars.map((b) => (
              <tr key={b.label}>
                <td className="py-1 pr-3 text-ink-soft">{b.label}</td>
                <td className="py-1 pr-3 text-muted">{b.detail}</td>
                <td className={cx("num py-1 text-right", toneOf(b.value))}>{format(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

/** Upright histogram of closed trades per P&L bucket. */
export function Histogram({ buckets, currency }: { buckets: { from: number; to: number; count: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 170;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const step = W / Math.max(1, buckets.length);
  const h = hover !== null ? buckets[hover] : null;
  const range = (b: { from: number; to: number }) => `${money(b.from, currency)} to ${money(b.to, currency)}`;
  return (
    <div>
      <figure className="relative m-0">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Trades by P&L, ${buckets.length} buckets from ${money(buckets[0]?.from, currency)} to ${money(buckets.at(-1)?.to, currency)}.`}
          onMouseMove={(e) => setHover(slotAt(e, buckets.length))}
          onMouseLeave={() => setHover(null)}
        >
          {buckets.map((b, i) => {
            const height = (b.count / max) * (H - 28);
            return <rect key={i} x={i * step + 2} y={H - 22 - height} width={Math.max(1, step - 4)} height={Math.max(b.count ? 2 : 0, height)} rx={1} fill={(b.from + b.to) / 2 >= 0 ? "var(--profit)" : "var(--loss)"} opacity={hover === null || hover === i ? 1 : 0.45} />;
          })}
          <line x1={0} x2={W} y1={H - 22} y2={H - 22} stroke="var(--line-strong)" />
          <text x={0} y={H - 6} fontSize="11" fill="var(--muted)">{money(buckets[0]?.from, currency)}</text>
          <text x={W} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{money(buckets.at(-1)?.to, currency)}</text>
        </svg>
        {h && <Tip>{range(h)}: {h.count}</Tip>}
      </figure>
      <DataTable summary="Show the counts">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-line">
            {buckets.filter((b) => b.count).map((b) => (
              <tr key={b.from}>
                <td className="num py-1 text-ink-soft">{range(b)}</td>
                <td className="num py-1 text-right">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Net P&L by weekday and hour of opening, as a real table so every cell has a text value. */
export function Heatmap({ rows, currency }: { rows: BreakdownRow[]; currency: string }) {
  const cells = new Map(rows.map((r) => [r.key, r]));
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)));
  const [hover, setHover] = useState<{ day: number; hour: number; row: BreakdownRow } | null>(null);
  return (
    <div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[620px] table-fixed border-separate border-spacing-[2px] text-[11px]">
          <caption className="sr-only">Net P&amp;L by weekday and hour of opening, local time</caption>
          <thead>
            <tr>
              <th scope="col" className="w-9"><span className="sr-only">Day</span></th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="num font-normal text-muted">{h % 3 === 0 ? String(h).padStart(2, "0") : <span className="sr-only">{h}</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_ORDER.map((d) => (
              <tr key={d}>
                <th scope="row" className="pr-1.5 text-left font-normal text-muted">{DAY_NAMES[d]}</th>
                {Array.from({ length: 24 }, (_, h) => {
                  const row = cells.get(`${d}-${h}`);
                  const strength = row ? 18 + Math.round((Math.abs(row.netPnl) / maxAbs) * 72) : 0;
                  return (
                    <td
                      key={h}
                      className="h-6 rounded-[2px]"
                      style={{ background: row ? `color-mix(in srgb, var(--${row.netPnl >= 0 ? "profit" : "loss"}) ${strength}%, transparent)` : "var(--sunken)" }}
                      onMouseEnter={() => row && setHover({ day: d, hour: h, row })}
                      onMouseLeave={() => setHover(null)}
                      title={row ? `${DAY_NAMES[d]} ${hh(h)}, ${row.trades} trades, ${money(row.netPnl, currency, true)}` : undefined}
                    >
                      {row && <span className="sr-only">{row.trades} trades, {money(row.netPnl, currency, true)}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="num mt-2 min-h-5 text-[12.5px] text-muted" aria-hidden>
        {hover ? `${DAY_NAMES[hover.day]} ${hh(hover.hour)}, ${hover.row.trades} trades, ${money(hover.row.netPnl, currency, true)}, ${pct(hover.row.winRate)} won` : "Hover a cell for its figures."}
      </p>
    </div>
  );
}

export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const SW = 120;
  const H = 32;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * SW).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${SW} ${H}`} className="hidden h-8 w-28 shrink-0 sm:block" aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--profit)" : "var(--loss)"} strokeWidth="1.5" />
    </svg>
  );
}

/** Horizontal bars for breakdown tables; width relative to the largest |value|. */
export function ValueBar({ value, max }: { value: number; max: number }) {
  const w = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="mt-1 h-1 w-full rounded-full bg-sunken" aria-hidden>
      <div className={cx("h-1 rounded-full", value >= 0 ? "bg-profit" : "bg-loss")} style={{ width: `${w}%` }} />
    </div>
  );
}

/** A comparison of groups: net P&L, win rate and what each trade averaged. */
export function BreakdownTable({ rows, currency, group, label = (k) => k }: { rows: BreakdownRow[]; currency: string; group: string; label?: (key: string) => string }) {
  if (rows.length === 0) return <p className="text-[13.5px] text-muted">No closed trades to compare yet. This fills in as trades close.</p>;
  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.netPnl)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead className="text-left text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-normal">{group}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Trades</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Won</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Per trade</th>
            <th scope="col" className="py-1.5 text-right font-normal">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-1.5 pr-3">
                <div className="max-w-44 truncate">{label(r.key)}</div>
                <ValueBar value={r.netPnl} max={maxAbs} />
              </td>
              <td className="num py-1.5 pr-3 text-right text-ink-soft">{r.trades}</td>
              <td className="num py-1.5 pr-3 text-right text-ink-soft">{pct(r.winRate)}</td>
              <td className={cx("num py-1.5 pr-3 text-right whitespace-nowrap", toneOf(r.netPnl))}>{money(r.netPnl / r.trades, currency, true)}</td>
              <td className={cx("num py-1.5 text-right whitespace-nowrap", toneOf(r.netPnl))}>{money(r.netPnl, currency, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Years down, months across, each cell a month's net P&L. */
export function MonthlyTable({ rows, currency }: { rows: PeriodRow[]; currency: string }) {
  const months = new Map(rows.map((r) => [r.key, r]));
  const years = [...new Set(rows.map((r) => r.key.slice(0, 4)))].sort().reverse();
  const yearTotal = (y: string) => rows.filter((r) => r.key.startsWith(y)).reduce((a, r) => a + r.pnl, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] table-fixed text-[12.5px]">
        <thead className="text-muted">
          <tr>
            <th scope="col" className="w-12 py-1 pr-2 text-left font-normal">Year</th>
            {MONTHS.map((m) => <th key={m} scope="col" className="py-1 text-right font-normal">{m}</th>)}
            <th scope="col" className="py-1 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y} className="border-t border-line">
              <th scope="row" className="num py-1.5 pr-2 text-left font-normal text-ink-soft">{y}</th>
              {MONTHS.map((_, i) => {
                const r = months.get(`${y}-${String(i + 1).padStart(2, "0")}`);
                return <td key={i} className={cx("num py-1.5 pl-2 text-right whitespace-nowrap", r ? toneOf(r.pnl) : "text-muted")} title={r ? `${r.trades} trades, ${r.wins} wins, ${r.losses} losses` : undefined}>{r ? money(r.pnl, currency, true) : "—"}</td>;
              })}
              <td className={cx("num py-1.5 pl-2 text-right font-medium whitespace-nowrap", toneOf(yearTotal(y)))}>{money(yearTotal(y), currency, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
