"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { CTA_HREF, CTA_LABEL, Wordmark } from "./SiteNav";
import { useReducedMotion, useScroller } from "./scroll";
import { useSound } from "./sound";

export const SCREENS = {
  dashboard: { src: "/site/screens/dashboard.webp", w: 2400, h: 1500, alt: "The Jarvis dashboard: KPI cards, the Jarvis Performance Score radar, cumulative and daily P&L charts, recent trades and a month calendar" },
  calendar: { src: "/site/screens/calendar.webp", w: 1586, h: 1138, alt: "The Jarvis month calendar with each day's P&L, trade count and win rate, and weekly totals" },
  kpis: { src: "/site/screens/kpi-row.webp", w: 2400, h: 226, alt: "Jarvis KPI cards: net P&L, trade win rate, profit factor, day win rate and average win to loss" },
  score: { src: "/site/screens/score-card.webp", w: 772, h: 736, alt: "The Jarvis Performance Score radar with six axes" },
  cumulative: { src: "/site/screens/cumulative.webp", w: 772, h: 736, alt: "Daily net cumulative P&L chart" },
  daily: { src: "/site/screens/daily.webp", w: 772, h: 736, alt: "Net daily P&L bar chart" },
  trades: { src: "/site/screens/trades-card.webp", w: 772, h: 1044, alt: "Recent trades and open positions table" },
  journal: { src: "/site/screens/journal.webp", w: 2400, h: 1500, alt: "The Jarvis trades list with filters, side, strategy, size, P&L and R" },
  drawer: { src: "/site/screens/trade-drawer.webp", w: 2400, h: 1500, alt: "A single trade opened in Jarvis with its fills, costs and notes" },
  reportsOverview: { src: "/site/screens/reports-overview.webp", w: 2400, h: 1500, alt: "Jarvis reports overview: P&L by period and the equity curve" },
  reportsTime: { src: "/site/screens/reports-time.webp", w: 2400, h: 1500, alt: "Jarvis reports by time: a weekday and hour heatmap of results" },
  reportsRisk: { src: "/site/screens/reports-risk.webp", w: 2400, h: 1500, alt: "Jarvis risk report: risk taken, R-multiples and holding time" },
  reportsInstruments: { src: "/site/screens/reports-instruments.webp", w: 2400, h: 1500, alt: "Jarvis instruments report: results per symbol, side and asset class" },
  reportsBehaviour: { src: "/site/screens/reports-behaviour.webp", w: 2400, h: 1500, alt: "Jarvis behaviour report: mistakes, tags, emotions and grades" },
  patterns: { src: "/site/screens/patterns.webp", w: 2400, h: 1500, alt: "Jarvis patterns: rule-based findings such as losers held longer than winners" },
  calendarPage: { src: "/site/screens/calendar-page.webp", w: 2400, h: 1500, alt: "The Jarvis calendar page with a selected day's trades" },
  market: { src: "/site/screens/market.webp", w: 2400, h: 1500, alt: "Jarvis market context with an instrument bias and the economic calendar, shown with demo data" },
  day: { src: "/site/screens/day.webp", w: 2400, h: 1500, alt: "The Jarvis daily journal with a pre-market plan and an end-of-day recap" },
  playbooks: { src: "/site/screens/playbooks.webp", w: 2400, h: 1500, alt: "Jarvis playbooks comparing strategies side by side" },
} as const;
export type ScreenKey = keyof typeof SCREENS;

export const SAMPLE_NOTE = "Real Jarvis screen, shown with its built-in sample trades.";

/** A real screen of the app. Presentation only: it's an image, so nothing in it can be operated. */
export function Shot({ name, className, caption, priority, sizes = "(min-width: 1024px) 60vw, 100vw" }: { name: ScreenKey; className?: string; caption?: string | false; priority?: boolean; sizes?: string }) {
  const s = SCREENS[name];
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || e.pointerType !== "mouse") return;
    ref.current!.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current!.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <figure className={cx("m-0", className)}>
      <div ref={ref} className="s-frame s-unveil" onPointerMove={onMove}>
        <Image src={s.src} width={s.w} height={s.h} alt={s.alt} sizes={sizes} priority={priority} draggable={false} className="pointer-events-none select-none" unoptimized />
      </div>
      {caption !== false && <figcaption className="s-caption">{caption ?? SAMPLE_NOTE}</figcaption>}
    </figure>
  );
}

/** A button that leans toward a fine pointer, then settles. Plain on touch and under reduced motion. */
export function Magnetic({ children, className, strength = 0.28 }: { children: React.ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const move = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) * strength;
    const y = (e.clientY - (r.top + r.height / 2)) * strength;
    ref.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };
  const leave = () => ref.current && (ref.current.style.transform = "");
  return (
    <span ref={ref} onPointerMove={move} onPointerLeave={leave} className={cx("inline-flex transition-transform duration-300 ease-[var(--s-ease-out)]", className)}>
      {children}
    </span>
  );
}

export function Arrow() {
  return (
    <svg className="s-btn-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Built today, or still being built. Every feature claim on the site carries one. */
export function Status({ kind }: { kind: "built" | "soon" | "needs-ai" }) {
  if (kind === "built") return <span className="s-tag s-tag-built">In Jarvis today</span>;
  if (kind === "needs-ai") return <span className="s-tag s-tag-needs">Built, needs your AI model</span>;
  return <span className="s-tag s-tag-soon">In development</span>;
}

/** The homepage's chapter rail: nine ticks on the right edge, the current act named, each a jump link. */
export function SessionRail({ chapters }: { chapters: { id: string; label: string }[] }) {
  const [current, setCurrent] = useState(0);
  const { scrollTo } = useScroller();
  const { play } = useSound();
  const prev = useRef(0);
  useEffect(() => {
    const els = chapters.map((c) => document.getElementById(c.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = els.indexOf(e.target as HTMLElement);
          if (i !== -1 && i !== prev.current) {
            prev.current = i;
            setCurrent(i);
            play("chapter");
          }
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [chapters, play]);
  return (
    <nav aria-label="Chapters" className="fixed top-1/2 right-[max(12px,1.2vw)] z-40 hidden -translate-y-1/2 lg:block" data-testid="session-rail">
      <ol className="flex flex-col items-end gap-2.5">
        {chapters.map((c, i) => (
          <li key={c.id}>
            <a
              href={`#${c.id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollTo(c.id);
              }}
              aria-current={current === i ? "step" : undefined}
              className="group flex items-center gap-3 py-0.5 no-underline"
            >
              <span className={cx("s-data text-[11.5px] transition-opacity duration-200", current === i ? "text-[var(--s-ink)] opacity-100" : "text-[var(--s-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")}>
                {String(i + 1).padStart(2, "0")} {c.label}
              </span>
              <span aria-hidden className={cx("block h-px transition-[width,background-color] duration-300", current === i ? "w-7 bg-[var(--s-accent-strong)]" : "w-3.5 bg-[var(--s-line-strong)] group-hover:bg-[var(--s-ink-soft)]")} />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-[var(--s-line)] bg-[var(--s-canvas)]" data-testid="site-footer">
      <div className="s-wrap grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-[14.5px] text-[var(--s-ink-soft)]">A trading journal and performance platform that runs on your own computer.</p>
          <Link href={CTA_HREF} className="s-btn s-btn-ghost mt-6 h-10! text-[14px]!">{CTA_LABEL}<Arrow /></Link>
        </div>
        {[
          ["Product", [["/platform", "Platform"], ["/features", "Features"], ["/platform#mt5", "MT5, read-only"], ["/platform#technology", "Technology"]]],
          ["Company", [["/about", "About"], ["/contact", "Contact"], [CTA_HREF, "Early access"]]],
          ["Jarvis", [["/login", "Sign in"], ["/welcome", "Home"]]],
        ].map(([title, links]) => (
          <div key={title as string}>
            <p className="s-label mb-3">{title as string}</p>
            <ul className="flex flex-col gap-2">
              {(links as string[][]).map(([href, label]) => (
                <li key={href + label}><Link href={href} className="s-link text-[14.5px]">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="s-wrap border-t border-[var(--s-line)] py-8">
        <p className="max-w-4xl text-[12.5px] leading-relaxed text-[var(--s-muted)]">
          Jarvis is software for reviewing your own trading. It doesn&apos;t give investment advice, signals or recommendations, and it never places trades: MT5 accounts connect with the read-only investor password. Trading foreign exchange, metals and other leveraged products carries a high risk of loss and is not suitable for everyone. Product screens on this site show Jarvis&apos;s built-in sample data, not real results.
        </p>
      </div>
    </footer>
  );
}
