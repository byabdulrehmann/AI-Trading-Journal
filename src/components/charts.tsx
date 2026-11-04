"use client";

import { useMemo, useState } from "react";
import type { DaySummary, EquityPoint } from "@/lib/domain/metrics";
import { dateOnly, money } from "@/lib/client/format";
import { cx } from "./ui";

/** Cumulative P&L by closed trade. Hover or focus a point for its value. */
export function EquityChart({ points, currency, onSelect }: { points: EquityPoint[]; currency: string; onSelect?: (tradeId: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const data = useMemo(() => [{ tradeId: 0, at: points[0]?.at ?? "", equity: 0 }, ...points], [points]);
  const min = Math.min(0, ...data.map((p) => p.equity));
  const max = Math.max(0, ...data.map((p) => p.equity));
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join("");
  const last = data.at(-1)!.equity;
  const h = hover !== null ? data[hover] : null;

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Equity curve over ${points.length} closed trades, ending at ${money(last, currency, true)}. Range ${money(min, currency)} to ${money(max, currency)}.`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="3 4" />
        <path d={`${path}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={last >= 0 ? "var(--profit-soft)" : "var(--loss-soft)"} />
        <path d={path} fill="none" stroke={last >= 0 ? "var(--profit)" : "var(--loss)"} strokeWidth="1.8" strokeLinejoin="round" />
        {data.map((p, i) =>
          i === 0 ? null : (
            <rect
              key={i}
              x={x(i) - (W / data.length) / 2}
              y={0}
              width={W / data.length}
              height={H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onClick={() => onSelect?.(p.tradeId)}
              style={{ cursor: onSelect ? "pointer" : undefined }}
            />
          ),
        )}
        {h && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" />
            <circle cx={x(hover)} cy={y(h.equity)} r="4" fill="var(--accent)" />
          </>
        )}
        <text x={pad.l} y={H - 6} fontSize="11" fill="var(--muted)">
          {data[1] ? dateOnly(data[1].at) : ""}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">
          {data.length > 1 ? dateOnly(data.at(-1)!.at) : ""}
        </text>
      </svg>
      {h && hover !== null && (
        <figcaption className="num pointer-events-none absolute top-1 right-2 rounded-md border border-line bg-raised px-2 py-1 text-[12px]">
          #{h.tradeId} · {dateOnly(h.at)} · {money(h.equity, currency, true)}
        </figcaption>
      )}
    </figure>
  );
}

/** Month grid of daily P&L. Each day is a button that reveals its trades. */
export function PnlCalendar({
  days,
  month,
  currency,
  onPickDay,
  selected,
}: {
  days: Map<string, DaySummary>;
  month: Date;
  currency: string;
  onPickDay: (d: DaySummary | null) => void;
  selected: string | null;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const maxAbs = Math.max(1, ...[...days.values()].map((d) => Math.abs(d.pnl)));
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11.5px] text-muted" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const summary = days.get(key(d));
          const intensity = summary ? 0.15 + 0.55 * (Math.abs(summary.pnl) / maxAbs) : 0;
          const color = summary ? (summary.pnl >= 0 ? "92 191 148" : "227 115 94") : null;
          return (
            <button
              key={i}
              type="button"
              disabled={!summary}
              onClick={() => onPickDay(selected === key(d) ? null : summary!)}
              aria-pressed={selected === key(d)}
              aria-label={summary ? `${key(d)}: ${summary.trades} trades, ${money(summary.pnl, currency, true)}` : `${key(d)}: no closed trades`}
              className={cx(
                "flex aspect-square min-h-11 flex-col items-start justify-between rounded-md border p-1.5 text-left transition-colors sm:aspect-[4/3]",
                summary ? "border-line hover:border-line-strong" : "border-transparent bg-sunken/50 text-muted",
                selected === key(d) && "ring-2 ring-accent",
              )}
              style={color ? { background: `rgb(${color} / ${intensity})` } : undefined}
            >
              <span className="text-[11.5px] text-ink-soft">{d}</span>
              {summary && <span className="num hidden text-[11.5px] text-ink sm:block">{money(summary.pnl, currency, true)}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  const W = 120;
  const H = 32;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hidden h-8 w-28 shrink-0 sm:block" aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--profit)" : "var(--loss)"} strokeWidth="1.5" />
    </svg>
  );
}

/** Horizontal bars for breakdown tables; width relative to the largest |value|. */
export function ValueBar({ value, max }: { value: number; max: number }) {
  const w = max ? Math.min(100, (Math.abs(value) / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-sunken" aria-hidden>
      <div className={cx("h-1.5 rounded-full", value >= 0 ? "bg-profit" : "bg-loss")} style={{ width: `${w}%` }} />
    </div>
  );
}
