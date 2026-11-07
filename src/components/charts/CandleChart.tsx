"use client";

import { useEffect, useRef } from "react";
import { displayZone } from "@/lib/client/format";
import type { Bar, BarMarker } from "@/lib/domain/bars";
import { zoneParts } from "@/lib/domain/zone";

type Charts = typeof import("lightweight-charts");
type Api = ReturnType<Charts["createChart"]>;

/** The library takes plain colours, and the design's tokens are oklch. The browser does the converting. */
function tokenColor(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#888888";
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888888";
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** The chart draws its axis in UTC, so times go in shifted to read as the display zone. */
const shifted = (t: number) => {
  const p = zoneParts(t * 1000, displayZone());
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000) + (t % 60);
};

interface Live {
  api: Api;
  series: ReturnType<Api["addSeries"]>;
  marks: { setMarkers: (m: never[]) => void };
}

function draw(c: Live, bars: Bar[], markers: BarMarker[], count: number, fit: boolean) {
  const shown = bars.slice(0, count);
  c.series.setData(shown.map((b) => ({ time: shifted(b.t) as never, open: b.o, high: b.h, low: b.l, close: b.c })));
  const limit = shown.length ? shown[shown.length - 1].t + (bars[1] ? bars[1].t - bars[0].t : 60) : 0;
  const info = tokenColor("--info");
  const ink = tokenColor("--ink");
  // A marker must sit on a bar that exists: the one its fill happened in.
  const barTime = (t: number) => {
    const on = [...shown].reverse().find((b) => b.t <= t);
    return on ? shifted(on.t) : shifted(t);
  };
  c.marks.setMarkers(
    markers
      .filter((m) => m.t < limit)
      .sort((a, b) => a.t - b.t)
      .map((m) => {
        const buying = (m.role === "entry") === (m.side === "long");
        return { time: barTime(m.t), position: buying ? "belowBar" : "aboveBar", shape: buying ? "arrowUp" : "arrowDown", color: m.role === "entry" ? info : ink, text: `${buying ? "Buy" : "Sell"} ${m.quantity}` };
      }) as never[],
  );
  if (fit) c.api.timeScale().fitContent();
}

export interface PriceLine {
  price: number;
  label: string;
  tone: "profit" | "loss" | "info";
}

/**
 * Candles with fills marked on them. Only the first \`upTo\` bars and the fills up to that time show, so a replay
 * reveals them in order. Everything drawn is on a canvas, so the page gives the same facts in words too.
 */
export function CandleChart({ bars, markers, lines = [], upTo, height = 260, label }: { bars: Bar[]; markers: BarMarker[]; lines?: PriceLine[]; upTo?: number; height?: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<Live | null>(null);
  const count = upTo ?? bars.length;

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void import("lightweight-charts").then((lib: Charts) => {
      if (cancelled || !box.current) return;
      const api = lib.createChart(box.current, {
        height,
        autoSize: true,
        layout: { background: { type: lib.ColorType.Solid, color: "transparent" }, textColor: tokenColor("--muted"), fontFamily: "var(--font-outlier), monospace", fontSize: 11 },
        grid: { vertLines: { color: tokenColor("--line") }, horzLines: { color: tokenColor("--line") } },
        rightPriceScale: { borderColor: tokenColor("--line") },
        timeScale: { borderColor: tokenColor("--line"), timeVisible: true, secondsVisible: false },
        crosshair: { mode: lib.CrosshairMode.Normal },
      });
      const [up, down] = [tokenColor("--profit"), tokenColor("--loss")];
      const typical = bars[0]?.c ?? 1;
      const precision = typical >= 1000 ? 2 : typical >= 10 ? 3 : 5;
      const series = api.addSeries(lib.CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat: { type: "price", precision, minMove: 10 ** -precision }, autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        // Keeps the stop and target on the chart, even when price never reached them.
        const base = original();
        if (!base || lines.length === 0) return base;
        const prices = lines.map((l) => l.price);
        return { ...base, priceRange: { minValue: Math.min(base.priceRange.minValue, ...prices), maxValue: Math.max(base.priceRange.maxValue, ...prices) } };
      } });
      for (const l of lines) series.createPriceLine({ price: l.price, title: l.label, color: tokenColor(`--${l.tone}`), lineWidth: 1, lineStyle: lib.LineStyle.Dashed, axisLabelVisible: true });
      chart.current = { api, series, marks: lib.createSeriesMarkers(series, []) as unknown as { setMarkers: (m: never[]) => void } };
      draw(chart.current, bars, markers, count, true);
      dispose = () => {
        api.remove();
        chart.current = null;
      };
    });
    return () => {
      cancelled = true;
      dispose();
    };
    // Rebuilt for new bars or lines. Moving through a replay only updates what's shown, below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, lines, height]);

  // Stepping keeps your zoom. A jump, or reaching the end, shows everything so far, entries included.
  const shownCount = useRef(count);
  useEffect(() => {
    if (!chart.current) return;
    draw(chart.current, bars, markers, count, Math.abs(count - shownCount.current) > 1 || count === bars.length);
    shownCount.current = count;
  }, [bars, count, markers]);

  return <div ref={box} role="img" aria-label={label} data-testid="candle-chart" style={{ height }} className="w-full min-w-0" />;
}
