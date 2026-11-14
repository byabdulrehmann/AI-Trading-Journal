"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MarketChart } from "./MarketChart";
import { Mark } from "./SiteNav";
import { useSound } from "./sound";
import { ENTERED_KEY as KEY } from "./boot-scripts";

export const ENTERED_EVENT = "jarvis-entered";
// The shortest the loading line takes to fill, so it reads as candles printing rather than a flash.
const LOAD_MS = 3200;

// The loading candles: a fixed rising walk, 40 bars in a 48-unit-tall box (y grows down).
const LOAD_BARS = (() => {
  const bars: { up: boolean; top: number; h: number; hi: number; lo: number }[] = [];
  let close = 38;
  for (let i = 0; i < 40; i++) {
    const trend = 38 - (i / 39) * 26; // drifts up the box from 38 to 12
    const open = close;
    const swing = Math.sin(i * 1.9) * 6 + Math.sin(i * 0.7) * 3;
    close = Math.max(5, Math.min(43, trend + swing * 0.8));
    const top = Math.min(open, close);
    const h = Math.max(2.5, Math.abs(open - close));
    const wick = 2 + Math.abs(Math.sin(i * 2.3)) * 4;
    // Rounded: Math.sin can differ in the last digits between Node and the browser, and these numbers go into the HTML.
    const r2 = (v: number) => Math.round(v * 100) / 100;
    bars.push({ up: close < open, top: r2(top), h: r2(h), hi: r2(Math.max(0.5, top - wick)), lo: r2(Math.min(47.5, top + h + 1.5 + Math.abs(Math.cos(i * 1.3)) * 3)) });
  }
  return bars;
})();

/** True once the visitor is past the gate; the hero waits for this before playing its entrance. */
export const hasEntered = () => document.documentElement.dataset.entered !== undefined;
const onEnter = (cb: () => void) => {
  window.addEventListener(ENTERED_EVENT, cb);
  return () => window.removeEventListener(ENTERED_EVENT, cb);
};
/** Whether the visitor is past the gate; false on the server and until hydration has read the page. */
export const useEntered = () => useSyncExternalStore(onEnter, hasEntered, () => false);

/**
 * The door to the site: it waits for the page's fonts and images to arrive (the count is real, not a timer), then asks
 * whether to come in with sound or without. The choice is the browser gesture sound needs, and it shows once per session.
 */
export function EnterGate() {
  const { setEnabled } = useSound();
  const gate = useRef<HTMLDivElement>(null);
  // Already in this session: the inline script hid the gate before paint, and it drops out on hydration.
  const entered = useEntered();
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const shown = !gone && (!entered || leaving);
  const ready = pct >= 100;

  // Everything behind the gate is out of reach for the keyboard and screen readers until the visitor comes in.
  useEffect(() => {
    const el = gate.current;
    // hasEntered() reads the page itself: during hydration the store still says "not entered" for a returning visitor.
    if (!shown || leaving || hasEntered() || !el?.parentElement) return;
    const behind = [...el.parentElement.children].filter((c): c is HTMLElement => c !== el && c instanceof HTMLElement);
    behind.forEach((c) => (c.inert = true));
    return () => behind.forEach((c) => (c.inert = false));
  }, [shown, leaving]);

  // Progress is what has actually loaded: fonts, then each image on the page. On every frame the line moves toward
  // it along an eased curve that takes at least LOAD_MS, so it fills smoothly instead of jumping.
  useEffect(() => {
    if (!shown || leaving) return;
    let fonts = false;
    let loaded = document.readyState === "complete";
    void document.fonts?.ready.then(() => (fonts = true));
    const onLoad = () => (loaded = true);
    window.addEventListener("load", onLoad);
    // A clock that only counts drawn frames (each capped at 34 ms): when the page is busy starting up and frames stall,
    // the line pauses and then carries on, instead of jumping ahead by the time it lost.
    let clock = 0;
    let last = performance.now();
    let shownPct = 0;
    let raf = 0;
    const frame = (now: number) => {
      clock += Math.min(34, now - last);
      last = now;
      const imgs = [...document.images];
      const done = imgs.filter((i) => i.complete).length;
      const target = loaded ? 100 : ((Number(fonts) + done) / (1 + imgs.length)) * 96;
      const t = Math.min(1, clock / LOAD_MS);
      const paced = (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) * 100;
      shownPct = Math.max(shownPct, Math.min(paced, target));
      setPct(shownPct);
      if (shownPct < 100) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("load", onLoad);
    };
  }, [shown, leaving]);

  const go = (sound: boolean) => {
    setEnabled(sound);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // Storage refused: the gate simply shows again on the next visit.
    }
    setLeaving(true);
    document.documentElement.dataset.entered = "";
    window.dispatchEvent(new Event(ENTERED_EVENT));
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => setGone(true), still ? 0 : 1100);
  };

  if (!shown) return null;
  return (
    <div
      ref={gate}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      data-tone="dark"
      data-lenis-prevent
      data-leaving={leaving || undefined}
      data-ready={ready || undefined}
      className="s-gate"
      data-testid="enter-gate"
    >
      {/* A live candlestick chart streams behind everything, fading out toward the edges. */}
      <MarketChart className="s-gate-chart" candles={64} seed={11} />
      {/* A pool of black under the words, so the chart never runs through them. */}
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 h-[70vh] w-[min(900px,120vw)] -translate-1/2 rounded-full bg-[radial-gradient(closest-side,var(--s-canvas)_35%,transparent)]" />
      <div aria-hidden className="s-gate-glow" />
      <div aria-hidden className="s-gate-scan" />
      <p aria-hidden className="s-data absolute top-6 left-6 text-[11px] tracking-[0.24em] text-[var(--s-muted)] uppercase sm:top-8 sm:left-10">Jarvis · trading intelligence</p>
      <p aria-hidden className="s-data absolute top-6 right-6 hidden text-[11px] tracking-[0.24em] text-[var(--s-muted)] uppercase sm:top-8 sm:right-10 sm:block">Live illustration</p>
      <p className="s-data absolute bottom-6 left-1/2 w-max -translate-x-1/2 text-[10.5px] tracking-[0.2em] text-[var(--s-muted)] uppercase">The chart is an illustration, not market data</p>

      <div className="relative w-[min(520px,86vw)]">
        <div className="flex items-center gap-4">
          <div className="s-gate-mark"><Mark size={52} /></div>
          <h2 id="gate-title" className="s-display text-[clamp(2rem,4vw,2.9rem)] leading-none text-[var(--s-ink)]">Jarvis</h2>
        </div>
        {/* The loading line is a row of candles that print from left to right as the page arrives. */}
        <svg aria-hidden viewBox={`0 0 ${LOAD_BARS.length * 10} 48`} preserveAspectRatio="none" className="mt-8 block h-12 w-full overflow-visible">
          {LOAD_BARS.map((b, i) => {
            // Each candle fades from a faint outline to its colour as the progress passes through its slot.
            const lit = Math.max(0, Math.min(1, (pct / 100) * LOAD_BARS.length - i));
            const candle = (color: string, opacity: number) => (
              <g opacity={opacity}>
                <line x1={i * 10 + 5} x2={i * 10 + 5} y1={b.hi} y2={b.lo} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <rect x={i * 10 + 1.5} y={b.top} width={7} height={b.h} rx={0.8} fill={color} />
              </g>
            );
            return (
              <g key={i}>
                {candle("var(--s-line-strong)", 0.6)}
                {lit > 0 && candle(b.up ? "var(--s-ink)" : "var(--s-accent-strong)", Math.round(lit * 100) / 100)}
              </g>
            );
          })}
        </svg>
        <p role="status" aria-live="polite" className="s-data mt-5 flex items-center justify-between text-[12.5px] tracking-[0.28em] uppercase">
          <span className="text-[var(--s-muted)]">{ready ? "Your record is ready" : "Loading your record"}</span>
          <span className="text-[var(--s-ink)] tabular-nums">{Math.floor(pct)}</span>
        </p>
        <div className="mt-9 flex min-h-[188px] flex-col items-center">
          {ready && (
            <div className="s-gate-choice flex flex-col items-center gap-4">
              <button type="button" data-cursor="cta" className="s-gate-btn s-gate-btn-main" onClick={() => go(true)} data-testid="enter-sound">
                <span aria-hidden className="s-eq"><i /><i /><i /><i /></span> Enter with sound
              </button>
              <button type="button" className="s-gate-btn s-gate-btn-quiet" onClick={() => go(false)} data-testid="enter-silent">
                Enter without sound
              </button>
              <p className="s-data mt-3 text-center text-[11px] tracking-[0.2em] text-[var(--s-muted)] uppercase">Sound on: an original score, with cues as you scroll</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
