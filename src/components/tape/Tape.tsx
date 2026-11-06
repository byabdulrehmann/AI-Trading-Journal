"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compactMoney, dateOnly, dateTime, displayZone, money, toneOf, zoneName } from "@/lib/client/format";
import { Button, DataTable, cx } from "@/components/ui";
import { brushRange, buildPoints, nearestIndex, tickColumns, xPositions, type Brushed } from "./model";

const GUTTER = 72; // The value axis sits on the right, where a trader's chart keeps its price.
const PAD = 10;
const AXIS = 22;
const TOP = 12;
const DRAG_PX = 5;
const HOLD_MS = 350;

const dayLabel = (ms: number, withYear: boolean) => new Date(ms).toLocaleDateString(undefined, { ...(withYear ? { month: "short", year: "numeric" } : { month: "short", day: "numeric" }), timeZone: displayZone() });

type Gesture = { id: number; startX: number; touch: boolean; brushing: boolean; timer?: ReturnType<typeof setTimeout> };

/** The signature: equity over time, the drawdown under it, every closed trade as a tick. Scrub, click, brush, or step by keyboard. */
export function Tape({
  equity,
  drawdown,
  currency,
  netPnl,
  summary,
  symbols,
  rangeActive,
  onOpen,
  onBrush,
  onClearRange,
}: {
  equity: { tradeId: number; at: string; equity: number }[];
  drawdown: { at: string; drawdown: number }[];
  currency: string;
  netPnl: number;
  summary: React.ReactNode;
  symbols: Map<number, string>;
  rangeActive: boolean;
  onOpen: (tradeId: number) => void;
  onBrush: (from: string, to: string) => void;
  onClearRange: () => void;
}) {
  const points = useMemo(() => buildPoints(equity, drawdown), [equity, drawdown]);
  const n = points.length;
  const well = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pinned = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);

  useEffect(() => {
    const el = well.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const plotL = PAD;
  const plotW = Math.max(0, w - PAD - GUTTER);
  const plotR = plotL + plotW;
  const tickH = Math.round(h * 0.28);
  const ddH = Math.round(h * 0.12);
  const eqH = Math.max(0, h - AXIS - tickH - ddH);
  const ddTop = eqH;
  const tickTop = eqH + ddH;
  const tickMid = tickTop + tickH / 2;

  const xs = useMemo(() => xPositions(points, plotL, plotW), [points, plotL, plotW]);

  const scales = useMemo(() => {
    const values = points.map((p) => p.equity);
    const min = Math.min(0, ...values);
    const max = Math.max(0, ...values);
    const span = max - min || 1;
    const maxDd = Math.max(0, ...points.map((p) => -p.drawdown));
    const maxNet = Math.max(0, ...points.map((p) => Math.abs(p.net)));
    return { min, max, span, maxDd, maxNet };
  }, [points]);
  const y = (v: number) => TOP + (1 - (v - scales.min) / scales.span) * Math.max(0, eqH - TOP - 8);

  const drawn = useMemo(() => {
    if (!w || !h || n === 0) return null;
    const yOf = (v: number) => TOP + (1 - (v - scales.min) / scales.span) * Math.max(0, eqH - TOP - 8);
    const line = points.map((p, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${yOf(p.equity).toFixed(1)}`).join("");
    const ddScale = scales.maxDd ? (ddH - 6) / scales.maxDd : 0;
    const band = n > 1 && scales.maxDd
      ? `M${xs[0].toFixed(1)},${ddTop + 1}${points.map((p, i) => `L${xs[i].toFixed(1)},${(ddTop + 1 - p.drawdown * ddScale).toFixed(1)}`).join("")}L${xs[n - 1].toFixed(1)},${ddTop + 1}Z`
      : "";
    const thin = Math.floor(plotW / n / 2);
    const tickW = Math.min(2, Math.max(1, thin));
    const reach = tickH / 2 - 3;
    const heightOf = (v: number) => Math.max(2, (v / (scales.maxNet || 1)) * reach);
    let wins = "";
    let losses = "";
    let flats = "";
    for (const c of tickColumns(points, xs, tickW)) {
      const x = c.x.toFixed(0);
      if (c.win) wins += `M${x},${tickMid.toFixed(1)}h${tickW}v${(-heightOf(c.win)).toFixed(1)}h${-tickW}Z`;
      if (c.loss) losses += `M${x},${tickMid.toFixed(1)}h${tickW}v${heightOf(c.loss).toFixed(1)}h${-tickW}Z`;
      if (c.flat && !c.win && !c.loss) flats += `M${x},${(tickMid - 1).toFixed(1)}h${tickW}v2h${-tickW}Z`;
    }
    return { line, band, wins, losses, flats, tickW, heightOf };
  }, [w, h, n, points, xs, scales, eqH, ddH, ddTop, tickH, tickMid, plotW]);

  const axisDates = useMemo(() => {
    if (n === 0 || !plotW) return [];
    const first = points[0].ms;
    const span = points[n - 1].ms - first;
    if (span <= 0) return [{ x: xs[0], label: dayLabel(first, false), anchor: n === 1 ? "middle" : "start" }];
    const count = Math.max(2, Math.min(6, Math.floor(plotW / 110)));
    const long = span > 300 * 864e5;
    return Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      return { x: plotL + t * plotW, label: dayLabel(first + t * span, long), anchor: i === 0 ? "start" : i === count - 1 ? "end" : "middle" };
    });
  }, [points, n, xs, plotL, plotW]);

  const cursor = useMemo(() => (cursorId === null ? -1 : points.findIndex((p) => p.tradeId === cursorId)), [cursorId, points]);
  const current = cursor >= 0 ? points[cursor] : null;
  const brushed: Brushed | null = brush ? brushRange(points, xs, brush.a, brush.b) : null;

  const localX = (clientX: number) => {
    const left = well.current?.getBoundingClientRect().left ?? 0;
    return Math.min(plotR, Math.max(plotL, clientX - left));
  };
  const scrubTo = (px: number) => {
    const i = nearestIndex(xs, px);
    if (i >= 0) setCursorId(points[i].tradeId);
  };
  const endGesture = () => {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setBrush(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (n === 0 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startX = localX(e.clientX);
    const touch = e.pointerType !== "mouse";
    const g: Gesture = { id: e.pointerId, startX, touch, brushing: false };
    gesture.current = g;
    pinned.current = touch;
    if (touch) {
      scrubTo(startX);
      g.timer = setTimeout(() => {
        g.brushing = true;
        setCursorId(null);
        setBrush({ a: g.startX, b: g.startX });
      }, HOLD_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const px = localX(e.clientX);
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse") {
        pinned.current = false;
        scrubTo(px);
      }
      return;
    }
    if (g.brushing) {
      setBrush({ a: g.startX, b: px });
      return;
    }
    if (g.touch) {
      if (Math.abs(px - g.startX) > DRAG_PX && g.timer) {
        clearTimeout(g.timer);
        g.timer = undefined;
      }
      scrubTo(px);
    } else if (Math.abs(px - g.startX) > DRAG_PX) {
      g.brushing = true;
      setCursorId(null);
      setBrush({ a: g.startX, b: px });
    } else {
      scrubTo(px);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const px = localX(e.clientX);
    if (g.brushing) {
      const range = brushRange(points, xs, g.startX, px);
      if (range && Math.abs(px - g.startX) > DRAG_PX) {
        setCursorId(null);
        onBrush(range.from, range.to);
      }
    } else if (!g.touch) {
      // Opens what the readout names: the crosshair has already snapped to that trade.
      const i = nearestIndex(xs, px);
      if (i >= 0) onOpen(points[i].tradeId);
    }
    endGesture();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (brush) endGesture();
      else if (current) {
        pinned.current = false;
        setCursorId(null);
      } else if (rangeActive) onClearRange();
      else return;
      e.preventDefault();
      return;
    }
    if (n === 0) return;
    if (e.key === "Enter") {
      if (current) {
        e.preventDefault();
        onOpen(current.tradeId);
      }
      return;
    }
    const step = e.key === "ArrowLeft" ? (cursor < 0 ? n - 1 : Math.max(0, cursor - 1)) : e.key === "ArrowRight" ? (cursor < 0 ? 0 : Math.min(n - 1, cursor + 1)) : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (step === null) return;
    e.preventDefault();
    pinned.current = true;
    setCursorId(points[step].tradeId);
  };

  const valueText = current ? `Trade #${current.tradeId}, ${symbols.get(current.tradeId) ?? ""}, closed ${dateTime(current.iso)} ${zoneName()}, net ${money(current.net, currency, true)}, equity ${money(current.equity, currency, true)}` : "No trade chosen";

  const alternative = n === 0
    ? "No closed trades yet, so there is no equity line."
    : `Equity across ${n} closed ${n === 1 ? "trade" : "trades"} from ${dateOnly(points[0].iso)} to ${dateOnly(points[n - 1].iso)}. It ends at ${money(points[n - 1].equity, currency, true)}, with a high of ${money(scales.max, currency, true)} and a low of ${money(scales.min, currency, true)}. The deepest drawdown is ${money(-scales.maxDd, currency)}.`;

  const table = useMemo(() => (
    <table className="w-full">
      <thead className="text-left text-[12.5px] text-muted">
        <tr>
          <th scope="col" className="sticky top-0 bg-canvas py-1 pr-3 font-normal">Trade</th>
          <th scope="col" className="sticky top-0 bg-canvas py-1 pr-3 font-normal">Symbol</th>
          <th scope="col" className="sticky top-0 bg-canvas py-1 pr-3 font-normal whitespace-nowrap">Closed, {zoneName()}</th>
          <th scope="col" className="sticky top-0 bg-canvas py-1 pr-3 text-right font-normal whitespace-nowrap">Net P&amp;L</th>
          <th scope="col" className="sticky top-0 bg-canvas py-1 pr-3 text-right font-normal">Equity</th>
          <th scope="col" className="sticky top-0 bg-canvas py-1 text-right font-normal">Drawdown</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.tradeId} className="border-t border-line">
            <td className="num py-1 pr-3"><button type="button" className="hover:underline" onClick={() => onOpen(p.tradeId)}>#{p.tradeId}</button></td>
            <td className="py-1 pr-3">{symbols.get(p.tradeId) ?? "—"}</td>
            <td className="num py-1 pr-3 whitespace-nowrap text-ink-soft">{dateTime(p.iso)}</td>
            <td className={cx("num py-1 pr-3 text-right whitespace-nowrap", toneOf(p.net))}>{money(p.net, currency, true)}</td>
            <td className="num py-1 pr-3 text-right whitespace-nowrap">{money(p.equity, currency, true)}</td>
            <td className="num py-1 text-right whitespace-nowrap text-ink-soft">{money(p.drawdown, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ), [points, symbols, currency, onOpen]);

  const cx0 = current ? xs[cursor] : 0;
  // Zero always shows; a high or low too close to it gives way, so labels never overprint.
  const axisVals = [0, ...[scales.max, scales.min].filter((v) => v !== 0 && Math.abs(y(v) - y(0)) >= 14)];

  return (
    <section aria-label="The Tape: equity and closed trades">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className={cx("num text-[34px] leading-none tracking-[-0.03em] sm:text-[44px]", toneOf(netPnl))}>{money(netPnl, currency, true)}</p>
        <p className="text-[13px] text-muted">Net P&amp;L in {currency}</p>
        <p className="ml-auto text-[13px] text-muted">{summary}</p>
        {rangeActive && <Button size="sm" className="max-sm:h-11" onClick={onClearRange}>Clear range</Button>}
      </div>

      <div className="mt-2 flex h-[68px] items-center gap-3 border-t border-line text-[13px] sm:h-9">
        <div className="min-w-0 flex-1 overflow-hidden">
          {brushed ? (
            <p className="truncate"><span className="num text-ink">{brushed.count}</span> <span className="text-muted">{brushed.count === 1 ? "trade" : "trades"},</span> <span className={cx("num", toneOf(brushed.net))}>{money(brushed.net, currency, true)}</span> <span className="text-muted">net. Release to filter to these days.</span></p>
          ) : brush ? (
            <p className="truncate text-muted">No closed trades in this stretch.</p>
          ) : current ? (
            <p className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0">
              <span className="num text-muted">#{current.tradeId}</span>
              <span className="font-medium text-ink">{symbols.get(current.tradeId) ?? ""}</span>
              <span className="num text-ink-soft">{dateTime(current.iso)} <span className="font-sans text-muted">{zoneName()}</span></span>
              <span className="whitespace-nowrap"><span className="text-muted">Net </span><span className={cx("num", toneOf(current.net))}>{money(current.net, currency, true)}</span></span>
              <span className="whitespace-nowrap"><span className="text-muted">Equity </span><span className="num text-ink">{money(current.equity, currency, true)}</span></span>
            </p>
          ) : n > 0 ? (
            <p className="text-muted"><span className="hidden sm:inline">Move across to read a trade, click to open it, drag across a stretch to filter. Arrow keys step, Enter opens.</span><span className="sm:hidden">Tap or drag to read a trade. Hold, then drag, to filter to a stretch.</span></p>
          ) : (
            <p className="text-muted">The equity curve starts when a trade closes. Add an exit to an open trade in the Journal.</p>
          )}
        </div>
        {current && !brush && <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => onOpen(current.tradeId)}>Open trade</Button>}
      </div>

      <p className="sr-only">{alternative}</p>

      <div
        ref={well}
        role="slider"
        tabIndex={0}
        aria-label="Closed trades in order. Left and right step, Enter opens, Escape clears."
        aria-valuemin={n ? 1 : 0}
        aria-valuemax={n}
        aria-valuenow={cursor >= 0 ? cursor + 1 : 0}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endGesture}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !pinned.current && !gesture.current) setCursorId(null);
        }}
        onContextMenu={(e) => {
          if (gesture.current?.touch) e.preventDefault();
        }}
        className={cx("ticks h-[max(220px,calc(40dvh-92px))] max-h-[420px] touch-pan-y bg-sunken select-none", n > 0 && "cursor-crosshair")}
      >
        {w > 0 && h > 0 && (
          <svg width={w} height={h} aria-hidden className="block" shapeRendering="geometricPrecision">
            {/* Lane rules and value axis */}
            <line x1={0} x2={w} y1={ddTop + 0.5} y2={ddTop + 0.5} stroke="var(--line)" />
            <line x1={0} x2={w} y1={tickTop + 0.5} y2={tickTop + 0.5} stroke="var(--line)" />
            <line x1={0} x2={w} y1={tickTop + tickH + 0.5} y2={tickTop + tickH + 0.5} stroke="var(--line)" />
            <line x1={plotR + PAD + 0.5} x2={plotR + PAD + 0.5} y1={0} y2={h} stroke="var(--line)" />
            {axisVals.map((v) => (
              <g key={v}>
                <line x1={plotL} x2={plotR} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} />
                <text x={w - 6} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--muted)" className="num">{v === 0 ? "0" : compactMoney(v)}</text>
              </g>
            ))}
            <text x={w - 6} y={ddTop + 15} textAnchor="end" fontSize={12} fill="var(--muted)">Drawdown</text>
            <text x={w - 6} y={tickTop + 15} textAnchor="end" fontSize={12} fill="var(--muted)">Trades</text>
            {scales.maxNet > 0 && tickH >= 44 && <text x={w - 6} y={tickTop + 30} textAnchor="end" fontSize={12} fill="var(--muted)" className="num">±{compactMoney(scales.maxNet).replace(/^[+−]/, "")}</text>}

            {drawn && (
              <>
                {drawn.band && <path d={drawn.band} fill="var(--loss-soft)" />}
                <line x1={plotL} x2={plotR} y1={Math.round(tickMid) + 0.5} y2={Math.round(tickMid) + 0.5} stroke="var(--line)" />
                <path d={drawn.wins} fill="var(--profit)" shapeRendering="crispEdges" />
                <path d={drawn.losses} fill="var(--loss)" shapeRendering="crispEdges" />
                <path d={drawn.flats} fill="var(--muted)" shapeRendering="crispEdges" />
                {n > 1 && <path d={drawn.line} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="miter" />}
                {n === 1 && <rect x={xs[0] - 3} y={y(points[0].equity) - 3} width={6} height={6} fill="var(--ink)" />}
              </>
            )}
            {axisDates.map((d, i) => (
              <text key={i} x={d.x} y={h - 7} textAnchor={d.anchor as "start" | "middle" | "end"} fontSize={12} fill="var(--muted)" className="num">{d.label}</text>
            ))}

            {brush && (
              <g>
                <rect x={Math.min(brush.a, brush.b)} y={0} width={Math.abs(brush.b - brush.a)} height={h - AXIS} fill="var(--info-soft)" />
                <line x1={brush.a + 0.5} x2={brush.a + 0.5} y1={0} y2={h - AXIS} stroke="var(--info)" />
                <line x1={brush.b + 0.5} x2={brush.b + 0.5} y1={0} y2={h - AXIS} stroke="var(--info)" />
              </g>
            )}
            {current && drawn && (
              <g>
                <line x1={Math.round(cx0) + 0.5} x2={Math.round(cx0) + 0.5} y1={0} y2={h - AXIS} stroke="var(--accent)" />
                <rect x={cx0 - 3} y={y(current.equity) - 3} width={6} height={6} fill="var(--accent)" />
                {current.net !== 0 && (
                  <rect x={Math.round(cx0) - 1} y={current.net > 0 ? tickMid - drawn.heightOf(current.net) : tickMid} width={3} height={drawn.heightOf(Math.abs(current.net))} fill={current.net > 0 ? "var(--profit)" : "var(--loss)"} />
                )}
              </g>
            )}
          </svg>
        )}
      </div>

      {n > 0 && <DataTable summary={`The Tape as a table, ${n} ${n === 1 ? "trade" : "trades"}`}>{table}</DataTable>}
    </section>
  );
}
