"use client";

import { useRef, useState } from "react";
import { money, toneOf } from "@/lib/client/format";
import { niceTicks, priceText, spreadLabels, tickOf } from "@/lib/client/ladder";
import { useBoxSize } from "@/lib/client/use-box-size";
import type { PositionResult } from "@/lib/domain/engine/position";
import { cx } from "../ui";

export type LadderField = "stopPrice" | "targetPrice" | "exitPrice";

const TOP = 10;
const BOTTOM = 8;
const LABEL_GAP = 17;
const MONO = { fontFamily: "var(--font-outlier)", fontVariantNumeric: "tabular-nums" };

/**
 * The trade drawn on a vertical price scale. Stop, target and exit can be dragged, or moved with the arrow keys when focused.
 * It only draws what the form holds, and its figures come from the form's computePosition preview.
 */
export function PriceLadder({
  side,
  entry,
  stop,
  target,
  exit,
  decimals,
  lockedExit,
  preview,
  currency,
  onChange,
  note,
  className,
}: {
  side: "long" | "short";
  entry: number | null;
  stop: number | null;
  target: number | null;
  exit: number | null;
  /** The precision of the entry price as typed. */
  decimals: number;
  /** Why the exit can't move here, if it can't. */
  lockedExit: "mt5" | "fills" | null;
  preview: PositionResult | null;
  currency: string;
  onChange: (field: LadderField, text: string) => void;
  /** The form's position line, set under the figures. */
  note?: string | null;
  className?: string;
}) {
  const [box, size] = useBoxSize<HTMLDivElement>({ width: 240, height: 320 });
  const svg = useRef<SVGSVGElement>(null);
  // The scale holds still during a drag, or the marker would run away from the pointer.
  const [drag, setDrag] = useState<{ field: LadderField; min: number; max: number } | null>(null);

  const values = [entry, stop, target, exit].filter((v): v is number => v !== null);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = high - low;
  // With one price there is no range to read, so a small window around it shows the marker and nothing more.
  const pad = spread > 0 ? spread * 0.16 : Math.max(high * 0.001, tickOf(decimals) * 10);
  const min = drag?.min ?? low - pad;
  const max = drag?.max ?? high + pad;

  const height = Math.max(160, size.height);
  const y = (v: number) => TOP + ((max - v) / (max - min)) * (height - TOP - BOTTOM);

  const ticks = values.length ? niceTicks(min, max, Math.max(2, Math.floor(height / 56))) : [];
  const stepDp = ticks.length > 1 ? Math.max(0, Math.ceil(-Math.log10(ticks[1] - ticks[0]) - 1e-9)) : decimals;
  const tickLabels = ticks.map((t) => t.toFixed(stepDp));
  const left = Math.max(36, Math.max(0, ...tickLabels.map((t) => t.length)) * 6.4 + 12);
  const right = size.width;

  const stopOk = entry !== null && stop !== null && (side === "long" ? stop < entry : stop > entry);
  const targetOk = entry !== null && target !== null && (side === "long" ? target > entry : target < entry);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  const markers = [
    { key: "entry", name: "Entry", value: entry, color: "var(--ink)", field: null },
    { key: "stop", name: "Stop", value: stop, color: "var(--loss)", field: "stopPrice" as const },
    { key: "target", name: "Target", value: target, color: "var(--profit)", field: "targetPrice" as const },
    { key: "exit", name: "Exit", value: exit, color: "var(--info)", field: lockedExit ? null : ("exitPrice" as const) },
  ].filter((m): m is typeof m & { value: number } => m.value !== null);
  const labelYs = spreadLabels(markers.map((m) => y(m.value) - 4), LABEL_GAP, TOP + 2, height - BOTTOM);

  const priceAt = (clientY: number) => {
    const top = svg.current?.getBoundingClientRect().top ?? 0;
    return max - ((clientY - top - TOP) / (height - TOP - BOTTOM)) * (max - min);
  };
  const move = (field: LadderField, price: number) => {
    const clamped = Math.min(max, Math.max(min, price));
    if (clamped > 0) onChange(field, priceText(clamped, decimals));
  };
  const nudge = (e: React.KeyboardEvent, field: LadderField, value: number) => {
    const by = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (!by) return;
    e.preventDefault();
    const next = value + by * (e.shiftKey ? 10 : 1) * tickOf(decimals);
    if (next > 0) onChange(field, priceText(next, decimals));
  };

  const netText = !preview ? null : preview.pnlStatus === "needs_rate" ? "Needs rate" : preview.pnlStatus === "over_closed" ? "Check fills" : preview.netPnl === null ? null : money(preview.netPnl, currency, true);
  const canDrag = markers.some((m) => m.field);
  const wrongStop = stop !== null && entry !== null && !stopOk ? (side === "long" ? "For a long, the stop sits below entry." : "For a short, the stop sits above entry.") : null;
  const wrongTarget = target !== null && entry !== null && !targetOk ? (side === "long" ? "For a long, the target sits above entry." : "For a short, the target sits below entry.") : null;

  return (
    <div className={cx("flex min-w-0 flex-col", className)} data-testid="price-ladder">
      <p className="pb-1.5 text-[13px] text-ink-soft">Price ladder</p>
      <div ref={box} className="relative min-h-0 flex-1 border-t border-line">
        {values.length === 0 ? (
          <p className="pt-3 text-[13px] text-muted">Type an entry, stop or target and the ladder draws here.</p>
        ) : (
          <svg
            ref={svg}
            width={size.width}
            height={height}
            className="absolute inset-0 block select-none"
            role="group"
            aria-label={`Price ladder, ${side}: ${markers.map((m) => `${m.name.toLowerCase()} ${priceText(m.value, decimals)}`).join(", ")}`}
          >
            <line x1={left} x2={left} y1={0} y2={height} stroke="var(--line-strong)" />
            {ticks.map((t, i) => (
              <g key={t}>
                <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
                <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--muted)" style={MONO}>{tickLabels[i]}</text>
              </g>
            ))}
            {stopOk && <rect data-band="risk" x={left} y={Math.min(y(entry), y(stop))} width={right - left} height={Math.abs(y(entry) - y(stop))} fill="var(--loss-soft)" />}
            {targetOk && <rect data-band="reward" x={left} y={Math.min(y(entry), y(target))} width={right - left} height={Math.abs(y(entry) - y(target))} fill="var(--profit-soft)" />}
            {markers.map((m, i) => {
              const my = y(m.value);
              const text = priceText(m.value, decimals);
              const line = (
                <>
                  <line x1={left} x2={right} y1={my} y2={my} stroke={m.color} strokeWidth={m.key === "entry" ? 1.5 : 1} />
                  {m.field && <rect x={left} y={my - 4} width={10} height={8} fill={m.color} />}
                  <text x={left + (m.field ? 16 : 6)} y={labelYs[i]} fontSize="12" fill="var(--ink-soft)">{m.name}</text>
                  <text x={right - 2} y={labelYs[i]} textAnchor="end" fontSize="12" fill="var(--ink)" style={MONO}>{text}</text>
                </>
              );
              if (!m.field)
                return (
                  <g key={m.key} data-marker={m.key}>
                    {lockedExit && m.key === "exit" && <title>{lockedExit === "mt5" ? "The exit comes from MT5 and stays as synced." : "The exit comes from the fills."}</title>}
                    {line}
                  </g>
                );
              const field = m.field;
              const hit = coarse ? 44 : 22;
              return (
                <g
                  key={m.key}
                  data-marker={m.key}
                  role="slider"
                  tabIndex={0}
                  aria-label={`${m.name} price`}
                  aria-orientation="vertical"
                  aria-valuemin={Number(min.toFixed(decimals))}
                  aria-valuemax={Number(max.toFixed(decimals))}
                  aria-valuenow={m.value}
                  aria-valuetext={`${m.name} ${text}`}
                  style={{ cursor: "ns-resize", touchAction: "none" }}
                  onKeyDown={(e) => nudge(e, field, m.value)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    e.currentTarget.focus({ preventScroll: true });
                    setDrag({ field, min, max });
                  }}
                  onPointerMove={(e) => {
                    if (drag?.field === field) move(field, priceAt(e.clientY));
                  }}
                  onPointerUp={() => setDrag(null)}
                  onPointerCancel={() => setDrag(null)}
                >
                  <rect x={left} y={my - hit / 2} width={right - left} height={hit} fill="transparent" />
                  {line}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <dl className="grid grid-cols-2 border-t border-line pt-1.5 text-[12.5px]">
        <div>
          <dt className="text-muted">R:R</dt>
          <dd className="num text-[14px] text-ink" data-testid="ladder-rr">
            {preview?.plannedR != null ? `1:${preview.plannedR}` : <Why text={stop === null || target === null ? "Needs stop, target" : preview ? "Check the stop" : "Needs entry and size"} />}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-muted">Net P&amp;L</dt>
          <dd className={cx("num text-[14px]", toneOf(preview?.netPnl))} data-testid="ladder-net">
            {netText ?? <Why text={!preview ? "Needs entry and size" : "Needs an exit"} />}
          </dd>
        </div>
      </dl>
      {(wrongStop || wrongTarget) && <p className="mt-1 text-[12.5px] text-warn">{wrongStop ?? wrongTarget}</p>}
      {note && <p className="num mt-1 text-[12px] text-muted">{note}</p>}
      {canDrag && <p className="mt-1 text-[12px] text-muted">Drag a marker, or focus it and use the arrow keys.</p>}
    </div>
  );
}

const Why = ({ text }: { text: string }) => <span className="font-sans text-[12.5px] text-muted">{text}</span>;
