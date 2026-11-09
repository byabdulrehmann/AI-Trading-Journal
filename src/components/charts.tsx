"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { BreakdownRow, PeriodRow } from "@/lib/domain/metrics";
import { compactMoney, dateOnly, money, pct, toneOf, zoneName } from "@/lib/client/format";
import { niceTicks } from "@/lib/client/ladder";
import { useBoxSize } from "@/lib/client/use-box-size";
import { DataTable, cx } from "./ui";

const MONO = { fontFamily: "var(--font-outlier)", fontVariantNumeric: "tabular-nums" };
const LABEL = 10.5;

/** Which of n evenly spaced items sits under the pointer. One overlay stays fast with thousands of points. */
function pointAt(e: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>, n: number, left: number, right: number) {
  const box = e.currentTarget.getBoundingClientRect();
  const span = box.width - left - right;
  return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left - left) / span) * (n - 1))));
}

const slotAt = (e: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>, n: number, left: number) => {
  const box = e.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left - left) / (box.width - left)) * n)));
};

/** Pointer or arrow keys pick the item a chart reads out; Enter acts on it. */
export function useScrub(n: number, onEnter?: (i: number) => void) {
  const [active, setActive] = useState<number | null>(null);
  const keys = (e: React.KeyboardEvent) => {
    const at = active ?? n - 1;
    const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n - 1 }[e.key];
    if (next !== undefined) {
      e.preventDefault();
      setActive(Math.max(0, Math.min(n - 1, next)));
    } else if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter(at);
    }
  };
  return {
    active,
    setActive,
    focusProps: {
      tabIndex: n ? 0 : undefined,
      onKeyDown: keys,
      onFocus: () => setActive((a) => a ?? n - 1),
      onBlur: () => setActive(null),
      onPointerLeave: () => setActive(null),
      style: { touchAction: "pan-y" as const },
    },
  };
}

/** The exact figures, beside the item they read, flipping at the middle so they stay on the chart. */
export function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  return (
    <figcaption aria-live="polite" className="pointer-events-none absolute top-0 z-[var(--z-raised)] border border-line-strong bg-raised px-2 py-1 text-[12px]" style={x > width / 2 ? { right: Math.max(0, width - x + 8) } : { left: x + 8 }}>
      {children}
    </figcaption>
  );
}

export interface LinePoint {
  at: string;
  value: number;
  tradeId?: number;
}

/** Equity or drawdown over closed trades. Point or arrow keys for a value; click or Enter opens the trade when onSelect is given. */
export function LineChart({ points, currency, label, onSelect, tone, height = 220, formatAt = dateOnly, domain }: { points: LinePoint[]; currency: string; label: string; onSelect?: (tradeId: number) => void; tone?: "profit" | "loss"; height?: number; formatAt?: (iso: string) => string; domain?: [number, number] }) {
  const [box, { width }] = useBoxSize<HTMLElement>({ width: 720, height: 0 });
  const select = (i: number) => {
    const id = points[i]?.tradeId;
    if (onSelect && id) onSelect(id);
  };
  const { active, setActive, focusProps } = useScrub(points.length, select);
  const pad = { l: 44, r: 8, t: 8, b: 20 };
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values, domain?.[0] ?? 0);
  const max = Math.max(0, ...values, domain?.[1] ?? 0);
  const span = max - min || 1;
  const last = points.at(-1)?.value ?? 0;
  const x = (i: number) => pad.l + (points.length > 1 ? i / (points.length - 1) : 0.5) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const color = tone ?? (last >= 0 ? "profit" : "loss");
  const h = active !== null ? points[active] : null;

  return (
    <figure ref={box} className="relative m-0">
      <svg
        width={width}
        height={height}
        className="block"
        role="img"
        aria-label={`${label}: ${points.length} closed trades, ending at ${money(last, currency, true)}, ranging from ${money(min, currency)} to ${money(max, currency)}.`}
        {...focusProps}
        onPointerMove={(e) => setActive(pointAt(e, points.length, pad.l, pad.r))}
        onClick={(e) => select(pointAt(e, points.length, pad.l, pad.r))}
        style={{ ...focusProps.style, cursor: onSelect ? "pointer" : undefined }}
      >
        {niceTicks(min, max, Math.max(2, Math.floor(height / 60))).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={LABEL} fill="var(--muted)" style={MONO}>{compactMoney(t)}</text>
          </g>
        ))}
        {tone === "loss" && points.length > 1 && <path d={`${path}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill="var(--loss-soft)" />}
        <path d={path} fill="none" stroke={`var(--${color})`} strokeWidth="1.5" strokeLinejoin="bevel" />
        {points.length === 1 && <rect x={x(0) - 3} y={y(points[0].value) - 3} width="6" height="6" fill={`var(--${color})`} />}
        {h && active !== null && (
          <>
            <line x1={x(active)} x2={x(active)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" />
            <rect x={x(active) - 3} y={y(h.value) - 3} width="6" height="6" fill="var(--ink)" />
          </>
        )}
        <text x={pad.l} y={height - 5} fontSize={LABEL} fill="var(--muted)" style={MONO}>{points[0] ? formatAt(points[0].at) : ""}</text>
        <text x={width - pad.r} y={height - 5} fontSize={LABEL} fill="var(--muted)" textAnchor="end" style={MONO}>{points.length > 1 ? formatAt(points.at(-1)!.at) : ""}</text>
      </svg>
      {h && active !== null && (
        <Tip x={x(active)} width={width}>
          <span className="num block text-muted">{dateOnly(h.at)}</span>
          <span className="num block text-ink">{money(h.value, currency, true)}</span>
        </Tip>
      )}
    </figure>
  );
}

export interface Bar {
  label: string;
  value: number;
  detail?: string;
}

/** Signed bars around a zero line, with the numbers also available as a table. `hrefFor` makes a bar open somewhere when it has a place to go. */
export function BarChart({ bars, label, format, height = 200, summary, hrefFor }: { bars: Bar[]; label: string; format: (n: number) => string; height?: number; summary: string; hrefFor?: (bar: Bar) => string | null }) {
  const router = useRouter();
  const [box, { width }] = useBoxSize<HTMLElement>({ width: 720, height: 0 });
  const go = (i: number) => {
    const href = bars[i] && hrefFor?.(bars[i]);
    if (href) router.push(href);
  };
  const { active, setActive, focusProps } = useScrub(bars.length, go);
  const pad = { l: 44, t: 8, b: 20 };
  const min = Math.min(0, ...bars.map((b) => b.value));
  const max = Math.max(0, ...bars.map((b) => b.value));
  const span = max - min || 1;
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (height - pad.t - pad.b);
  const step = (width - pad.l) / Math.max(1, bars.length);
  const w = Math.min(24, Math.max(1, step - 3));
  const h = active !== null ? bars[active] : null;
  const longest = Math.max(0, ...bars.map((b) => b.label.length));
  const everyLabel = step >= longest * 6.4 + 8;

  return (
    <div>
      <figure ref={box} className="relative m-0">
        <svg
          width={width}
          height={height}
          className="block"
          role="img"
          aria-label={`${label}: ${bars.length} bars, from ${format(min)} to ${format(max)}.${hrefFor ? " Enter opens the trades of the chosen bar." : ""}`}
          {...focusProps}
          onPointerMove={(e) => setActive(slotAt(e, bars.length, pad.l))}
          onClick={(e) => go(slotAt(e, bars.length, pad.l))}
          style={{ ...focusProps.style, cursor: hrefFor ? "pointer" : undefined }}
        >
          {niceTicks(min, max, Math.max(2, Math.floor(height / 60))).map((t) => (
            <g key={t}>
              {t !== 0 && <line x1={pad.l} x2={width} y1={y(t)} y2={y(t)} stroke="var(--line)" />}
              <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={LABEL} fill="var(--muted)" style={MONO}>{compactMoney(t)}</text>
            </g>
          ))}
          {bars.map((b, i) => (
            <rect
              key={b.label}
              data-bar={b.label}
              x={pad.l + i * step + (step - w) / 2}
              y={Math.min(y(b.value), y(0))}
              width={w}
              height={Math.max(1, Math.abs(y(b.value) - y(0)))}
              fill={b.value >= 0 ? "var(--profit)" : "var(--loss)"}
              opacity={active === null || active === i ? 1 : 0.45}
            />
          ))}
          <line x1={pad.l} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
          {everyLabel
            ? bars.map((b, i) => <text key={b.label} x={pad.l + i * step + step / 2} y={height - 5} fontSize={LABEL} fill="var(--muted)" textAnchor="middle" style={MONO}>{b.label}</text>)
            : (
              <>
                <text x={pad.l} y={height - 5} fontSize={LABEL} fill="var(--muted)" style={MONO}>{bars[0]?.label}</text>
                <text x={width} y={height - 5} fontSize={LABEL} fill="var(--muted)" textAnchor="end" style={MONO}>{bars.length > 1 ? bars.at(-1)!.label : ""}</text>
              </>
            )}
        </svg>
        {h && active !== null && (
          <Tip x={pad.l + active * step + step / 2} width={width}>
            <span className="num block text-muted">{h.label}</span>
            <span className={cx("num block", toneOf(h.value))}>{format(h.value)}</span>
            {h.detail && <span className="num block text-ink-soft">{h.detail}</span>}
          </Tip>
        )}
      </figure>
      <DataTable summary={summary}>
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-line">
            {bars.map((b) => {
              const href = hrefFor?.(b);
              return (
                <tr key={b.label}>
                  <td className="num py-1 pr-3 text-ink-soft">{href ? <Link href={href} className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">{b.label}</Link> : b.label}</td>
                  <td className="num py-1 pr-3 text-muted">{b.detail}</td>
                  <td className={cx("num py-1 text-right", toneOf(b.value))}>{format(b.value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataTable>
    </div>
  );
}

/** Upright histogram of closed trades per P&L bucket. */
export function Histogram({ buckets, currency }: { buckets: { from: number; to: number; count: number }[]; currency: string }) {
  const [box, { width }] = useBoxSize<HTMLElement>({ width: 720, height: 0 });
  const { active, setActive, focusProps } = useScrub(buckets.length);
  const H = 180;
  const pad = { l: 28, t: 8, b: 20 };
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const step = (width - pad.l) / Math.max(1, buckets.length);
  const y = (c: number) => pad.t + (1 - c / max) * (H - pad.t - pad.b);
  const h = active !== null ? buckets[active] : null;
  const range = (b: { from: number; to: number }) => `${money(b.from, currency)} to ${money(b.to, currency)}`;
  return (
    <div>
      <figure ref={box} className="relative m-0">
        <svg
          width={width}
          height={H}
          className="block"
          role="img"
          aria-label={`Trades by P&L, ${buckets.length} buckets from ${money(buckets[0]?.from, currency)} to ${money(buckets.at(-1)?.to, currency)}.`}
          {...focusProps}
          onPointerMove={(e) => setActive(slotAt(e, buckets.length, pad.l))}
        >
          {niceTicks(0, max, 3).filter((t) => Number.isInteger(t)).map((t) => (
            <g key={t}>
              {t !== 0 && <line x1={pad.l} x2={width} y1={y(t)} y2={y(t)} stroke="var(--line)" />}
              <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={LABEL} fill="var(--muted)" style={MONO}>{t}</text>
            </g>
          ))}
          {buckets.map((b, i) => (
            <rect key={i} x={pad.l + i * step + 1} y={y(b.count)} width={Math.max(1, step - 2)} height={b.count ? Math.max(2, y(0) - y(b.count)) : 0} fill={(b.from + b.to) / 2 >= 0 ? "var(--profit)" : "var(--loss)"} opacity={active === null || active === i ? 1 : 0.45} />
          ))}
          <line x1={pad.l} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" />
          <text x={pad.l} y={H - 5} fontSize={LABEL} fill="var(--muted)" style={MONO}>{money(buckets[0]?.from, currency)}</text>
          <text x={width} y={H - 5} fontSize={LABEL} fill="var(--muted)" textAnchor="end" style={MONO}>{money(buckets.at(-1)?.to, currency)}</text>
        </svg>
        {h && active !== null && (
          <Tip x={pad.l + active * step + step / 2} width={width}>
            <span className="num block text-muted">{range(h)}</span>
            <span className="num block text-ink">{h.count} {h.count === 1 ? "trade" : "trades"}</span>
          </Tip>
        )}
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

/** Net P&L by weekday and hour of opening, as a real table so every cell has a text value. Pointer or arrow keys read a cell. */
export function Heatmap({ rows, currency, onOpen }: { rows: BreakdownRow[]; currency: string; onOpen?: (day: number, hour: number) => void }) {
  const cells = new Map(rows.map((r) => [r.key, r]));
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.netPnl)));
  const [active, setActive] = useState<{ day: number; hour: number } | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const row = active && cells.get(`${active.day}-${active.hour}`);
  // One tab stop for the whole grid: the first cell with trades, or the one last read.
  const first = rows.length ? DAY_ORDER.flatMap((d) => Array.from({ length: 24 }, (_, h) => `${d}-${h}`)).find((k) => cells.has(k)) : "1-0";
  const stop = active ? `${active.day}-${active.hour}` : first;

  const keys = (e: React.KeyboardEvent, day: number, hour: number) => {
    if (e.key === "Enter" && cells.has(`${day}-${hour}`)) return onOpen?.(day, hour);
    const at = DAY_ORDER.indexOf(day);
    const moved = { ArrowLeft: [at, hour - 1], ArrowRight: [at, hour + 1], ArrowUp: [at - 1, hour], ArrowDown: [at + 1, hour] }[e.key];
    if (!moved) return;
    e.preventDefault();
    const nextDay = DAY_ORDER[Math.max(0, Math.min(6, moved[0]))];
    const nextHour = Math.max(0, Math.min(23, moved[1]));
    grid.current?.querySelector<HTMLElement>(`[data-cell="${nextDay}-${nextHour}"]`)?.focus();
  };

  return (
    <div>
      <table ref={grid} className="w-full table-fixed border-separate border-spacing-px text-[11px]">
        <caption className="sr-only">Net P&amp;L by weekday and hour of opening, {zoneName()}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-9"><span className="sr-only">Day</span></th>
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col" className="num font-normal text-muted">
                {h % 6 === 0 ? String(h).padStart(2, "0") : h % 3 === 0 ? <span className="hidden sm:inline">{String(h).padStart(2, "0")}</span> : <span className="sr-only">{h}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_ORDER.map((d) => (
            <tr key={d}>
              <th scope="row" className="pr-1.5 text-left font-normal text-muted">{DAY_NAMES[d]}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const r = cells.get(`${d}-${h}`);
                const strength = r ? 18 + Math.round((Math.abs(r.netPnl) / maxAbs) * 72) : 0;
                const isActive = active?.day === d && active.hour === h;
                return (
                  <td
                    key={h}
                    data-cell={`${d}-${h}`}
                    tabIndex={stop === `${d}-${h}` ? 0 : -1}
                    className={cx("h-6 outline-offset-[-2px]", isActive && "outline-1 outline-[var(--ink)]")}
                    style={{ background: r ? `color-mix(in srgb, var(--${r.netPnl >= 0 ? "profit" : "loss"}) ${strength}%, transparent)` : "var(--sunken)" }}
                    onPointerEnter={() => setActive({ day: d, hour: h })}
                    onPointerDown={() => setActive({ day: d, hour: h })}
                    onFocus={() => setActive({ day: d, hour: h })}
                    onClick={() => r && onOpen?.(d, h)}
                    onKeyDown={(e) => keys(e, d, h)}
                  >
                    <span className="sr-only">{DAY_NAMES[d]} {hh(h)}, {r ? `${r.trades} trades, ${money(r.netPnl, currency, true)}, ${pct(r.winRate)} won` : "no trades"}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 min-h-5 text-[12.5px] text-muted">
        {active ? (
          <span className="num">{DAY_NAMES[active.day]} {hh(active.hour)}, {row ? `${row.trades} ${row.trades === 1 ? "trade" : "trades"}, ${money(row.netPnl, currency, true)}, ${pct(row.winRate)} won` : "no trades"}</span>
        ) : (
          "Point at a cell, or focus the grid and use the arrow keys, for its figures."
        )}
      </p>
      <DataTable summary="Show the numbers">
        <table className="w-full text-[13px]">
          <tbody className="divide-y divide-line">
            {DAY_ORDER.flatMap((d) =>
              Array.from({ length: 24 }, (_, h) => cells.get(`${d}-${h}`))
                .map((r, h) => r && (
                  <tr key={r.key}>
                    <td className="num py-1 pr-3 text-ink-soft">{DAY_NAMES[d]} {hh(h)}</td>
                    <td className="num py-1 pr-3 text-right text-muted">{r.trades} {r.trades === 1 ? "trade" : "trades"}</td>
                    <td className="num py-1 pr-3 text-right text-muted">{pct(r.winRate)} won</td>
                    <td className={cx("num py-1 text-right", toneOf(r.netPnl))}>{money(r.netPnl, currency, true)}</td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </DataTable>
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

/** An inline bar for breakdown tables, signed around a centre rule; length relative to the largest |value|. */
export function ValueBar({ value, max }: { value: number; max: number }) {
  const w = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="relative h-2 w-full" aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      <div className={cx("absolute inset-y-0", value >= 0 ? "left-1/2 bg-profit" : "right-1/2 bg-loss")} style={{ width: `${w / 2}%` }} />
    </div>
  );
}

/** A comparison of groups: net P&L, win rate and what each trade averaged. `hrefFor` links a row where it has somewhere to go. */
export function BreakdownTable({ rows, currency, group, label = (k) => k, hrefFor, compact, empty = "No closed trades to compare yet. This fills in as trades close." }: { empty?: string; compact?: boolean; rows: BreakdownRow[]; currency: string; group: string; label?: (key: string) => string; hrefFor?: (key: string) => string | null }) {
  const router = useRouter();
  if (rows.length === 0) return <p className="text-[13.5px] text-muted">{empty}</p>;
  const maxAbs = Math.max(0, ...rows.map((r) => Math.abs(r.netPnl)));
  return (
    <table className="w-full table-fixed text-[13.5px]">
      <thead className="text-left text-[12.5px] text-muted">
        <tr className="border-b border-line">
          <th scope="col" className="py-1.5 pr-3 font-normal whitespace-nowrap">{group}</th>
          {!compact && <th scope="col" className="hidden w-[22%] py-1.5 pr-3 font-normal sm:table-cell"><span className="sr-only">Net, as a bar</span></th>}
          <th scope="col" className="hidden w-16 py-1.5 pr-3 text-right font-normal whitespace-nowrap sm:table-cell">Trades</th>
          <th scope="col" className="hidden w-14 py-1.5 pr-3 text-right font-normal whitespace-nowrap sm:table-cell">Won</th>
          <th scope="col" className="hidden w-[6.5rem] py-1.5 pr-3 text-right font-normal whitespace-nowrap sm:table-cell">Per trade</th>
          <th scope="col" className="w-[6.5rem] py-1.5 text-right font-normal whitespace-nowrap">Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const href = hrefFor?.(r.key) ?? null;
          const perTrade = money(r.netPnl / r.trades, currency, true);
          return (
            <tr
              key={r.key}
              data-row={r.key}
              className={cx("border-b border-line", href && "cursor-pointer hover:bg-raised")}
              onClick={(e) => {
                if (href && !(e.target as HTMLElement).closest("a")) router.push(href);
              }}
            >
              <td className="py-1.5 pr-3">
                <div className="truncate" title={label(r.key)}>
                  {href ? <Link href={href} className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">{label(r.key)}</Link> : label(r.key)}
                </div>
                <div className="mt-1 sm:hidden"><ValueBar value={r.netPnl} max={maxAbs} /></div>
                <div className="mt-0.5 text-[12.5px] text-muted sm:hidden">
                  <span className="num">{r.trades}</span> trades, <span className="num">{pct(r.winRate)}</span> won, <span className="num">{perTrade}</span> per trade
                </div>
              </td>
              {!compact && <td className="hidden py-1.5 pr-3 align-middle sm:table-cell"><ValueBar value={r.netPnl} max={maxAbs} /></td>}
              <td className="num hidden py-1.5 pr-3 text-right text-ink-soft sm:table-cell">{r.trades}</td>
              <td className="num hidden py-1.5 pr-3 text-right text-ink-soft sm:table-cell">{pct(r.winRate)}</td>
              <td className={cx("num hidden py-1.5 pr-3 text-right whitespace-nowrap sm:table-cell", toneOf(r.netPnl))}>{perTrade}</td>
              <td className={cx("num py-1.5 text-right align-top whitespace-nowrap sm:align-middle", toneOf(r.netPnl))}>{money(r.netPnl, currency, true)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Years down, months across, each cell a month's net P&L. `hrefFor` takes a month key such as 2026-03. */
export function MonthlyTable({ rows, currency, hrefFor }: { rows: PeriodRow[]; currency: string; hrefFor?: (key: string) => string | null }) {
  const months = new Map(rows.map((r) => [r.key, r]));
  const years = [...new Set(rows.map((r) => r.key.slice(0, 4)))].sort().reverse();
  const yearTotal = (y: string) => rows.filter((r) => r.key.startsWith(y)).reduce((a, r) => a + r.pnl, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] table-fixed text-[12.5px]">
        <thead className="text-muted">
          <tr>
            <th scope="col" className="sticky left-0 w-12 bg-canvas py-1 pr-2 text-left font-normal">Year</th>
            {MONTHS.map((m) => <th key={m} scope="col" className="py-1 text-right font-normal">{m}</th>)}
            <th scope="col" className="py-1 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y} className="border-t border-line">
              <th scope="row" className="num sticky left-0 bg-canvas py-1.5 pr-2 text-left font-normal text-ink-soft">{y}</th>
              {MONTHS.map((_, i) => {
                const key = `${y}-${String(i + 1).padStart(2, "0")}`;
                const r = months.get(key);
                const href = r ? hrefFor?.(key) : null;
                const text = r ? money(r.pnl, currency, true) : "—";
                const about = r ? `${r.trades} trades, ${r.wins} wins, ${r.losses} losses` : undefined;
                return (
                  <td key={i} className={cx("num py-1.5 pl-2 text-right whitespace-nowrap", r ? toneOf(r.pnl) : "text-muted")} title={about}>
                    {href ? <Link href={href} aria-label={`${MONTHS[i]} ${y}: ${text}, ${about}`} className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">{text}</Link> : text}
                  </td>
                );
              })}
              <td className={cx("num py-1.5 pl-2 text-right font-medium whitespace-nowrap", toneOf(yearTotal(y)))}>{money(yearTotal(y), currency, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One series on 0 to 100 axes, so no legend: the card's title names it. A blank axis is skipped, never drawn as zero. */
export function RadarChart({ axes, label, size = 280 }: { axes: { label: string; value: number | null }[]; label: string; size?: number }) {
  const { active, setActive, focusProps } = useScrub(axes.length);
  const c = size / 2;
  const radius = c - 42;
  const angle = (i: number) => -Math.PI / 2 + (i / axes.length) * 2 * Math.PI;
  const point = (i: number, v: number): [number, number] => [c + (v / 100) * radius * Math.cos(angle(i)), c + (v / 100) * radius * Math.sin(angle(i))];
  const ring = (v: number) => axes.map((_, i) => point(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
  const known = axes.flatMap((a, i) => (a.value === null ? [] : [{ i, v: a.value }]));
  const shape = known.map(({ i, v }) => point(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
  const h = active !== null ? axes[active] : null;
  return (
    <figure className="relative m-0 min-w-0" style={{ maxWidth: size + 72 }}>
      <svg
        viewBox={`-36 0 ${size + 72} ${size}`}
        className="block w-full"
        role="img"
        aria-label={`${label}. ${axes.map((a) => `${a.label} ${a.value === null ? "not known" : Math.round(a.value)}`).join(", ")}.`}
        {...focusProps}
      >
        {[25, 50, 75, 100].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke={v === 100 ? "var(--line-strong)" : "var(--line)"} />)}
        {axes.map((a, i) => {
          const [x, y] = point(i, 100);
          const [lx, ly] = point(i, 116);
          const anchor = Math.abs(lx - c) < 4 ? "middle" : lx > c ? "start" : "end";
          return (
            <g key={a.label}>
              <line x1={c} y1={c} x2={x} y2={y} stroke="var(--line)" strokeDasharray={a.value === null ? "2 3" : undefined} />
              <text x={lx} y={ly + 3.5} textAnchor={anchor} fontSize={LABEL + 0.5} fill={active === i ? "var(--ink)" : "var(--muted)"}>{a.label.split(" ")[0]}</text>
            </g>
          );
        })}
        {known.length > 2 && <polygon points={shape} fill="var(--info-soft)" stroke="var(--info)" strokeWidth="2" strokeLinejoin="bevel" />}
        {known.map(({ i, v }) => {
          const [x, y] = point(i, v);
          return <rect key={i} x={x - 4} y={y - 4} width="8" height="8" fill={active === i ? "var(--ink)" : "var(--info)"} stroke="var(--canvas)" strokeWidth="2" />;
        })}
        {/* Larger than the marks, so they're easy to hit. */}
        {axes.map((a, i) => {
          const [x, y] = point(i, a.value ?? 100);
          return <rect key={a.label} x={x - 16} y={y - 16} width="32" height="32" fill="transparent" onPointerEnter={() => setActive(i)} />;
        })}
      </svg>
      {h && <figcaption aria-live="polite" className="pointer-events-none absolute top-0 left-0 z-[var(--z-raised)] border border-line-strong bg-raised px-2 py-1 text-[12px]">{h.label}: <span className="num">{h.value === null ? "not known" : Math.round(h.value)}</span></figcaption>}
    </figure>
  );
}
