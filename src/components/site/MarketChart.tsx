"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./scroll";

/**
 * A decorative candlestick chart drawn on a canvas: high-contrast candles (rising in ink, falling in red), a glowing
 * moving average, a live last-price line and a crosshair that follows a mouse anywhere over it. The prices are a
 * seeded random walk, an illustration only, never market data or anyone's results.
 *
 * - "stream": candles keep arriving from the right and the last one ticks live.
 * - "scrub": the chart draws itself as `progress.current` goes from 0 to 1 (driven by scroll), with trade marks.
 * Under reduced motion both show one still, finished frame.
 */
export interface ChartProgress {
  current: number;
}

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

function series(n: number, seed: number): Candle[] {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const out: Candle[] = [];
  let price = 100;
  let drift = 0;
  for (let i = 0; i < n; i++) out.push(next());
  return out;
  function next(): Candle {
    drift = drift * 0.86 + (rand() - 0.48) * 0.9;
    const o = price;
    const c = o + drift + (rand() - 0.5) * 1.4;
    const h = Math.max(o, c) + rand() * 1.1;
    const l = Math.min(o, c) - rand() * 1.1;
    price = c;
    return { o, h, l, c };
  }
}

// Kept beside the series so a stream can keep extending the same walk.
function extend(list: Candle[], seed: number) {
  const last = list[list.length - 1];
  const r = Math.sin(seed * 12.9898 + list.length * 78.233) * 43758.5453;
  const u = r - Math.floor(r);
  const r2 = Math.sin(seed * 4.1414 + list.length * 3.7) * 9631.17;
  const v = r2 - Math.floor(r2);
  const o = last.c;
  const c = o + (u - 0.49) * 2.4;
  list.push({ o, c, h: Math.max(o, c) + v * 1.1, l: Math.min(o, c) - (1 - v) * 1.1 });
}

const TRADES = [
  { at: 0.22, side: "buy" },
  { at: 0.37, side: "sell" },
  { at: 0.58, side: "buy" },
  { at: 0.81, side: "sell" },
] as const;

export function MarketChart({
  mode = "stream",
  progress,
  className,
  candles = 70,
  seed = 7,
  grid = true,
  readout = true,
  active = true,
}: {
  mode?: "stream" | "scrub";
  progress?: ChartProgress;
  className?: string;
  candles?: number;
  seed?: number;
  grid?: boolean;
  readout?: boolean;
  /** False draws one still frame and stops, for a chart that is covered (the hero's, behind the entry gate). */
  active?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const data = series(mode === "scrub" ? candles : candles + 1, seed);
    let colors = read();
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let pointer: { x: number; y: number } | null = null;
    let shift = 0; // 0..1 slide while a new candle arrives
    let lastAdd = performance.now();
    let tick = 0;
    let lo = 0;
    let hi = 0;

    function read() {
      const cs = getComputedStyle(canvas!);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      return { up: v("--s-ink"), down: v("--s-accent-strong"), accent: v("--s-accent"), line: v("--s-line"), muted: v("--s-muted"), canvas: v("--s-canvas") };
    }
    const size = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    size();

    const frame = (now: number) => {
      raf = 0;
      if (mode === "stream" && !reduced) {
        // A new candle every 0.9 s; between, the last one ticks.
        const since = now - lastAdd;
        if (since > 900) {
          extend(data, seed);
          data.shift();
          lastAdd = now;
        }
        shift = Math.min(1, since / 900);
        tick = Math.sin(now / 260) * 0.35 + Math.sin(now / 97) * 0.18;
      }
      draw();
      if (!reduced && visible && active) raf = requestAnimationFrame(frame);
    };

    function draw() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      const p = mode === "scrub" ? (reduced ? 1 : Math.max(0, Math.min(1, progress?.current ?? 1))) : 1;
      const count = mode === "scrub" ? Math.max(1, Math.ceil(p * data.length)) : data.length;
      const shown = data.slice(0, count);
      // Live candle: the last close wanders a little around where it will settle.
      const live = mode === "stream" && !reduced ? { ...shown[shown.length - 1] } : null;
      if (live) {
        live.c += tick;
        live.h = Math.max(live.h, live.c);
        live.l = Math.min(live.l, live.c);
        shown[shown.length - 1] = live;
      }
      // The price range eases toward the visible candles so the chart never jumps.
      const range = mode === "scrub" ? data : shown;
      const tLo = Math.min(...range.map((c) => c.l));
      const tHi = Math.max(...range.map((c) => c.h));
      if (hi === 0 || reduced) [lo, hi] = [tLo, tHi];
      lo += (tLo - lo) * 0.08;
      hi += (tHi - hi) * 0.08;
      const pad = (hi - lo) * 0.12;
      const y = (v: number) => h - ((v - (lo - pad)) / (hi - lo + pad * 2)) * h;
      const slots = mode === "scrub" ? data.length : data.length - 1;
      const step = w / slots;
      const body = Math.max(2, step * 0.56);
      const xAt = (i: number) => (i + 0.5) * step - (mode === "stream" ? shift * step : 0);

      if (grid) {
        ctx!.strokeStyle = colors.line;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        for (let g = 1; g < 6; g++) {
          const gy = Math.round((h / 6) * g) + 0.5;
          ctx!.moveTo(0, gy);
          ctx!.lineTo(w, gy);
        }
        ctx!.stroke();
      }

      // Candles: wick first, then the body. The newest candle in a scrub grows in from its open.
      shown.forEach((c, i) => {
        const x = xAt(i);
        if (x < -step || x > w + step) return;
        const up = c.c >= c.o;
        let grow = 1;
        if (mode === "scrub" && i === shown.length - 1 && p < 1) grow = Math.min(1, (p * data.length - i) || 1);
        const close = c.o + (c.c - c.o) * grow;
        ctx!.strokeStyle = ctx!.fillStyle = up ? colors.up : colors.down;
        ctx!.lineWidth = Math.max(1, step * 0.08);
        ctx!.beginPath();
        ctx!.moveTo(Math.round(x) + 0.5, y(c.o + (c.h - c.o) * grow));
        ctx!.lineTo(Math.round(x) + 0.5, y(c.o + (c.l - c.o) * grow));
        ctx!.stroke();
        const top = y(Math.max(c.o, close));
        ctx!.fillRect(x - body / 2, top, body, Math.max(1.5, y(Math.min(c.o, close)) - top));
      });

      // A glowing moving average over the candles. The glow is a wide faint stroke under the line: canvas shadowBlur
      // looks the same but costs a blur of the whole path every frame, which made the streaming charts stutter.
      const N = 9;
      const avgLine = new Path2D();
      shown.forEach((_, i) => {
        const from = Math.max(0, i - N + 1);
        const avg = shown.slice(from, i + 1).reduce((a, c) => a + c.c, 0) / (i - from + 1);
        if (i === 0) avgLine.moveTo(xAt(i), y(avg));
        else avgLine.lineTo(xAt(i), y(avg));
      });
      ctx!.lineJoin = "round";
      ctx!.strokeStyle = colors.down;
      ctx!.globalAlpha = 0.22;
      ctx!.lineWidth = 7;
      ctx!.stroke(avgLine);
      ctx!.globalAlpha = 1;
      ctx!.strokeStyle = colors.accent;
      ctx!.lineWidth = 2;
      ctx!.stroke(avgLine);

      // Trade marks on the scrub chart: where an entry and an exit would sit on the bars.
      if (mode === "scrub") {
        for (const t of TRADES) {
          const i = Math.floor(t.at * data.length);
          if (i >= shown.length) continue;
          const c = data[i];
          const x = xAt(i);
          const buy = t.side === "buy";
          const ty = buy ? y(c.l) + 16 : y(c.h) - 16;
          const a = Math.min(1, (p * data.length - i) / 3);
          ctx!.globalAlpha = a;
          ctx!.fillStyle = buy ? colors.up : colors.down;
          ctx!.beginPath();
          ctx!.moveTo(x, buy ? ty - 9 : ty + 9);
          ctx!.lineTo(x - 7, buy ? ty + 3 : ty - 3);
          ctx!.lineTo(x + 7, buy ? ty + 3 : ty - 3);
          ctx!.closePath();
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      }

      // The last price: a dashed line across and a tag at the edge.
      const last = shown[shown.length - 1];
      const ly = Math.round(y(last.c)) + 0.5;
      ctx!.setLineDash([4, 5]);
      ctx!.strokeStyle = last.c >= last.o ? colors.up : colors.down;
      ctx!.globalAlpha = 0.6;
      ctx!.beginPath();
      ctx!.moveTo(0, ly);
      ctx!.lineTo(w, ly);
      ctx!.stroke();
      ctx!.setLineDash([]);
      ctx!.globalAlpha = 1;
      if (readout) {
        const label = last.c.toFixed(2);
        ctx!.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        const tw = ctx!.measureText(label).width + 14;
        ctx!.fillStyle = colors.down;
        ctx!.beginPath();
        ctx!.roundRect(w - tw - 6, ly - 10, tw, 20, 6);
        ctx!.fill();
        ctx!.fillStyle = "#fff";
        ctx!.fillText(label, w - tw + 1, ly + 4);
      }

      // Crosshair for a mouse over the chart, with the candle under it read out.
      if (pointer && readout) {
        const i = Math.max(0, Math.min(shown.length - 1, Math.round((pointer.x + (mode === "stream" ? shift * step : 0)) / step - 0.5)));
        const c = shown[i];
        const cx = Math.round(xAt(i)) + 0.5;
        ctx!.strokeStyle = colors.muted;
        ctx!.globalAlpha = 0.7;
        ctx!.setLineDash([2, 4]);
        ctx!.beginPath();
        ctx!.moveTo(cx, 0);
        ctx!.lineTo(cx, h);
        ctx!.moveTo(0, Math.round(pointer.y) + 0.5);
        ctx!.lineTo(w, Math.round(pointer.y) + 0.5);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.globalAlpha = 1;
        const text = `O ${c.o.toFixed(2)}  H ${c.h.toFixed(2)}  L ${c.l.toFixed(2)}  C ${c.c.toFixed(2)}`;
        ctx!.font = "500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        const tw = ctx!.measureText(text).width + 16;
        const bx = Math.min(w - tw - 8, Math.max(8, cx + 12));
        ctx!.fillStyle = colors.canvas;
        ctx!.globalAlpha = 0.9;
        ctx!.beginPath();
        ctx!.roundRect(bx, 10, tw, 24, 8);
        ctx!.fill();
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = c.c >= c.o ? colors.up : colors.down;
        ctx!.fillText(text, bx + 8, 26);
      }
    }

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      size();
      kick();
    });
    ro.observe(canvas);
    // The page may cover the chart with other layers, so the crosshair listens on the window.
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const yy = e.clientY - r.top;
      pointer = x >= 0 && yy >= 0 && x <= r.width && yy <= r.height ? { x, y: yy } : null;
      kick();
    };
    const recolor = () => {
      colors = read();
      kick();
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("jarvis-site-theme", recolor);
    // Scrub charts redraw when the page scrolls; the frame loop also runs while they're on screen.
    window.addEventListener("scroll", kick, { passive: true });
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("jarvis-site-theme", recolor);
      window.removeEventListener("scroll", kick);
    };
  }, [mode, progress, candles, seed, grid, readout, reduced, active]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
