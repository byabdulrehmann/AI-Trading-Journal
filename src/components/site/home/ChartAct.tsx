"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useRef } from "react";
import { MarketChart } from "../MarketChart";
import { useReducedMotion } from "../scroll";

const LEGEND = [
  { label: "Rising candle", swatch: "bg-[var(--s-ink)]" },
  { label: "Falling candle", swatch: "bg-[var(--s-accent-strong)]" },
  { label: "Your entry", swatch: "s-tri-up" },
  { label: "Your exit", swatch: "s-tri-down" },
];

/**
 * Between the ribbon and the problem: a chart the visitor draws by scrolling. Candles arrive bar by bar, then the
 * marks of a trader's entries and exits land on them, which is what Trade Replay shows with a trader's own fills.
 */
export function ChartAct() {
  const root = useRef<HTMLElement>(null);
  // The ref itself is the progress box the chart reads ({ current: 0..1 }); scroll writes it without re-rendering.
  const progressRef = useRef(0);
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      if (reduced) {
        progressRef.current = 1;
        return;
      }
      gsap
        .timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            onUpdate: (st) => (progressRef.current = Math.min(1, st.progress / 0.85)),
          },
        })
        .fromTo(".chart-frame", { scale: 0.86, rotateX: 18, opacity: 0.4 }, { scale: 1, rotateX: 0, opacity: 1, duration: 0.35 }, 0)
        .fromTo(".chart-word-a", { xPercent: 10 }, { xPercent: -30, duration: 1 }, 0)
        .fromTo(".chart-word-b", { xPercent: -30 }, { xPercent: 10, duration: 1 }, 0)
        .fromTo(".chart-legend > *", { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.04, duration: 0.12 }, 0.5);
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <section id="chart" data-sc-act="chart" data-tone="dark" ref={root} className="relative h-[240svh] motion-reduce:h-auto" aria-labelledby="chart-title">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden motion-reduce:relative motion-reduce:h-auto motion-reduce:py-28">
        {/* Two giant outlined words drift past each other behind the chart. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-[6vh] opacity-60">
          <p className="chart-word-a s-outline font-[family-name:var(--s-font-display)] text-[clamp(3rem,10vw,9rem)] leading-none font-semibold whitespace-nowrap tracking-[-0.04em]">Open · High · Low</p>
          <p className="chart-word-b s-outline font-[family-name:var(--s-font-display)] text-[clamp(3rem,10vw,9rem)] leading-none font-semibold whitespace-nowrap tracking-[-0.04em]">Close · Entry · Exit</p>
        </div>
        <div className="s-wrap relative">
          <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="s-eyebrow">Every candle, every fill</p>
              <h2 id="chart-title" data-reveal="words" className="s-display s-h2 mt-3 max-w-[16ch]">The market keeps a record. Now so do you.</h2>
            </div>
            <p className="s-lede max-w-[40ch]! lg:text-right">In Trade Replay your own fills sit on the chart, so you can see exactly where you came in and where you got out.</p>
          </div>
          <div className="mt-10 [perspective:1600px]">
            <div className="chart-frame s-card overflow-hidden p-3 sm:p-5">
              <MarketChart mode="scrub" progress={progressRef} candles={90} seed={23} className="block h-[min(48vh,460px)] w-full" />
            </div>
          </div>
          <ul className="chart-legend mt-6 flex flex-wrap items-center gap-x-7 gap-y-3 text-[14px] text-[var(--s-ink-soft)]">
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-2.5">
                <span aria-hidden className={`inline-block size-3 rounded-[3px] ${l.swatch}`} />
                {l.label}
              </li>
            ))}
            <li className="s-caption ml-auto">Illustration only: not market data or a real trade.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
