"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Image from "next/image";
import { useRef } from "react";
import { cx } from "@/components/ui";
import { SAMPLE_NOTE, SCREENS, type ScreenKey } from "../parts";
import { useReducedMotion } from "../scroll";
import { useSound } from "../sound";

/*
 * The signature move. Thirty-one days of October 2026 from Jarvis's built-in sample journal, measured off the real
 * calendar screenshot (public/site/screens/calendar.webp, 1586 × 1138): column and row origins in pixels, so every
 * candle lands exactly on its day before the screenshot itself fades in.
 */
const COLS = [35, 225, 417, 607, 797, 987, 1179];
const ROWS = [193, 377, 561, 745, 929];
const CELL = { w: 181, h: 174 };
const IMG = { w: 1586, h: 1138 };
// u: up day, d: down day, U/D: the month's biggest days, -: no trades. Oct 1 2026 is a Thursday.
// Days 1 to 31, read off the screenshot: 1-3 | 4-10 | 11-17 | 18-24 | 25-31, a week per group.
const MONTH = "uu-" + "udUudd-" + "-dDuUu-" + "-ddddu-" + "-dDuuu-";
const DAYS = Array.from({ length: 31 }, (_, i) => {
  const slot = i + 4; // Thursday is the 5th column of the first row
  return { day: i + 1, col: slot % 7, row: Math.floor(slot / 7), kind: MONTH[i] };
});
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
// Literal colours: GSAP tweens these backgrounds and cannot interpolate CSS variables.
const FILL: Record<string, string> = { u: "#26302b", U: "#34413a", d: "#3a2620", D: "#56302a", "-": "#121816" };
const BODY: Record<string, string> = { u: "#d8d3c3", U: "#d8d3c3", d: "#ff6a4a", D: "#ff6a4a" };

const TILES: { key: ScreenKey; area: string; label: string }[] = [
  { key: "kpis", area: "kpi", label: "Net P&L, win rate, profit factor, day win rate, average win and loss" },
  { key: "score", area: "score", label: "Jarvis Performance Score" },
  { key: "cumulative", area: "cum", label: "Equity curve, by day" },
  { key: "daily", area: "daily", label: "Daily P&L" },
  { key: "trades", area: "trades", label: "Trade history and open positions" },
];

function Tile({ k }: { k: ScreenKey }) {
  const s = SCREENS[k];
  return (
    <div className="s-frame h-full">
      <Image src={s.src} width={s.w} height={s.h} alt={s.alt} unoptimized className="h-full w-full object-cover object-top" sizes="(min-width: 1024px) 30vw, 90vw" />
    </div>
  );
}

export function Peak() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { play } = useSound();

  useGSAP(
    () => {
      if (reduced) return;
      const mm = gsap.matchMedia();
      mm.add({ wide: "(min-width: 1024px)", narrow: "(max-width: 1023.98px)" }, (ctx) => {
        const wide = ctx.conditions?.wide;
        const cal = root.current!.querySelector<HTMLElement>(".peak-cal")!;
        // Where the calendar sits in the assembled dashboard, against where it is held large for the fall.
        const hero = () => {
          const stage = root.current!.querySelector<HTMLElement>(".peak-stage")!.getBoundingClientRect();
          // Measured untransformed, or the held scale would compound on every refresh.
          const prev = cal.style.transform;
          cal.style.transform = "none";
          const r = cal.getBoundingClientRect();
          cal.style.transform = prev;
          const scale = Math.min((stage.width * 0.86) / r.width, (stage.height * 0.8) / r.height);
          return { x: stage.left + stage.width / 2 - (r.left + r.width / 2), y: stage.top + stage.height / 2 - (r.top + r.height / 2), scale };
        };
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: root.current,
            start: "top top",
            end: wide ? "+=340%" : "+=220%",
            pin: ".peak-pin",
            scrub: 0.7,
            invalidateOnRefresh: true,
            onUpdate: (st) => {
              if (st.direction !== 1) return;
              if (st.progress > 0.42) play("reveal");
              if (st.progress > 0.66) play("data");
            },
          },
        });
        if (wide) tl.set(cal, { x: () => hero().x, y: () => hero().y, scale: () => hero().scale }, 0);
        tl.set(".peak-tile", { opacity: 0, y: 40, scale: 0.94 }, 0)
          .set(".peak-real", { opacity: 0 }, 0)
          .set(".peak-cell", { opacity: 0 }, 0)
          .from(".peak-heading", { y: 30, opacity: 0, duration: 0.06 }, 0);
        // Candles fall from above the frame, tumbling, in a ragged order, and land on their days.
        root.current!.querySelectorAll<HTMLElement>(".peak-candle").forEach((el, i) => {
          const at = 0.04 + (i % 7) * 0.012 + Math.floor(i / 7) * 0.035;
          tl.fromTo(el, { yPercent: -900 - (i % 5) * 120, rotation: (i % 2 ? 1 : -1) * (40 + (i * 13) % 50), opacity: 0 }, { yPercent: 0, rotation: 0, opacity: 1, duration: 0.14, ease: "power2.in" }, at)
            // and flatten into the day cell
            .to(el, { scaleX: 6.5, scaleY: 1.6, borderRadius: "6px", backgroundColor: el.dataset.fill, duration: 0.06, ease: "power3.out" }, at + 0.15)
            .to(el.querySelector(".peak-wick"), { opacity: 0, duration: 0.03 }, at + 0.15);
        });
        tl.to(".peak-cell", { opacity: 1, duration: 0.05, stagger: 0.004 }, 0.3)
          .to(".peak-real", { opacity: 1, duration: 0.07 }, 0.42)
          .to(".peak-candle", { opacity: 0, duration: 0.04 }, 0.47);
        if (wide) {
          // The camera pulls back: the calendar settles into its slot and the dashboard assembles around it.
          tl.to(cal, { x: 0, y: 0, scale: 1, duration: 0.2, ease: "power2.inOut" }, 0.55)
            .to(".peak-tile", { opacity: 1, y: 0, scale: 1, duration: 0.14, stagger: 0.035, ease: "power2.out" }, 0.62)
            .from(".peak-legend", { opacity: 0, y: 16, duration: 0.08 }, 0.86)
            .to({}, { duration: 0.08 });
        } else {
          tl.to(".peak-tile", { opacity: 1, y: 0, scale: 1, duration: 0.12, stagger: 0.04 }, 0.6).to({}, { duration: 0.1 });
        }
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <section id="journal" data-sc-act="journal" ref={root} className="relative" aria-labelledby="journal-title">
      <div className="peak-pin relative flex min-h-[100svh] flex-col overflow-hidden pt-[88px] pb-8">
        <div className="peak-heading s-wrap relative z-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <h2 id="journal-title" className="s-display s-h2 max-w-[14ch]">The trading journal</h2>
          <p className="s-lede max-w-[40ch] lg:text-right">Every closed trade lands on its day. Every figure on the dashboard is worked out from them.</p>
        </div>
        <div className="peak-stage s-wrap relative mt-6 min-h-0 flex-1">
          <div className="mx-auto grid h-full max-w-[1240px] gap-3 [grid-template-areas:'kpi''cal''score''cum''daily''trades'] lg:grid-cols-3 lg:[grid-template-areas:'kpi_kpi_kpi''score_cum_daily''trades_cal_cal']">
            {TILES.map((t) => (
              <div key={t.key} className={cx("peak-tile min-w-0", t.key === "kpis" ? "" : "hidden lg:block")} style={{ gridArea: t.area }}>
                <Tile k={t.key} />
              </div>
            ))}
            {/* The calendar: candles land as days, then the real screen fades in over them. */}
            <div className="peak-cal relative min-w-0 origin-center will-change-transform" style={{ gridArea: "cal" }}>
              <div className="s-frame relative" style={{ aspectRatio: `${IMG.w} / ${IMG.h}` }}>
                <div className="absolute inset-0 bg-[var(--s-surface)]" />
                <div className="peak-month absolute top-[3.2%] left-[9%] font-[family-name:var(--s-font-text)] text-[clamp(10px,1.5vw,18px)] font-semibold text-[var(--s-ink)]">October 2026</div>
                {DAYS.map((d) => (
                  <div key={d.day} className="peak-cell absolute rounded-[5px]" style={{ left: pct(COLS[d.col], IMG.w), top: pct(ROWS[d.row], IMG.h), width: pct(CELL.w, IMG.w), height: pct(CELL.h, IMG.h), background: FILL[d.kind] }}>
                    <span className="absolute top-[6%] right-[8%] text-[clamp(7px,0.8vw,11px)] text-[var(--s-ink-soft)]">{d.day}</span>
                  </div>
                ))}
                {DAYS.filter((d) => d.kind !== "-").map((d) => (
                  <div key={`c${d.day}`} className="absolute grid place-items-center" style={{ left: pct(COLS[d.col], IMG.w), top: pct(ROWS[d.row], IMG.h), width: pct(CELL.w, IMG.w), height: pct(CELL.h, IMG.h) }}>
                    <div className="peak-candle relative h-[62%] w-[15%] rounded-[2px] opacity-0" style={{ background: BODY[d.kind] }} data-fill={FILL[d.kind]}>
                      <span className="peak-wick absolute top-[-22%] bottom-[-22%] left-1/2 -z-10 w-[14%] -translate-x-1/2 rounded-full" style={{ background: BODY[d.kind], opacity: 0.6 }} />
                    </div>
                  </div>
                ))}
                <Image src={SCREENS.calendar.src} width={IMG.w} height={IMG.h} alt={SCREENS.calendar.alt} unoptimized className="peak-real absolute inset-0 h-full w-full" sizes="(min-width: 1024px) 60vw, 92vw" />
              </div>
            </div>
          </div>
        </div>
        <p className="peak-legend s-wrap s-caption relative z-10 mt-4 text-center">
          {SAMPLE_NOTE} Net P&amp;L, win rate, profit factor, average win and loss, daily P&amp;L, equity curve, the Jarvis Performance Score, open positions, the month and every trade.
        </p>
      </div>
    </section>
  );
}
