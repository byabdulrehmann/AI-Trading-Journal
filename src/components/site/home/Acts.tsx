"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { cx } from "@/components/ui";
import { SAMPLE_NOTE, SCREENS, Status, type ScreenKey } from "../parts";
import { useReducedMotion } from "../scroll";

/* ---------- Act 02: the trader's problem (kinetic lines over a ground that drifts colder) ---------- */

const PROBLEMS = [
  ["Fragmented trading data", "The statement is in an email, the trades are in MT5, the reasons are in your head."],
  ["Poor journaling", "A spreadsheet started with good intentions and abandoned by the second losing week."],
  ["Inconsistent strategies", "Three setups this week. Nothing checks which one actually pays."],
  ["Emotional decisions", "The trade after a loss is rarely the one you planned."],
  ["Overtrading", "Trade after trade on the day you meant to take two."],
  ["Revenge trading", "Win it back, then win back the win-it-back."],
  ["No performance visibility", "Ask which session is your best. Most traders guess."],
];

export function Problem() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      gsap.to(root.current, { "--problem-ground": 1, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
      gsap.utils.toArray<HTMLElement>(".problem-row").forEach((row, i, all) => {
        gsap.fromTo(row, { opacity: 0.18, x: 24 }, { opacity: 1, x: 0, ease: "power2.out", scrollTrigger: { trigger: row, start: "top 78%", end: "top 52%", scrub: true } });
        // Each problem is struck through as the next one arrives: the list never settles.
        if (i < all.length - 1)
          gsap.fromTo(row.querySelector(".problem-strike"), { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { trigger: all[i + 1], start: "top 70%", end: "top 50%", scrub: true } });
      });
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  return (
    <section
      id="problem" data-sc-act="problem"
      ref={root}
      className="s-section relative"
      style={{ ["--problem-ground" as string]: 0, background: "linear-gradient(180deg, var(--s-canvas), color-mix(in oklab, var(--s-canvas), color-mix(in oklab, var(--s-loss) 12%, var(--s-canvas)) calc(var(--problem-ground) * 70%)) 60%, var(--s-canvas))" }}
      aria-labelledby="problem-title"
    >
      <div className="s-wrap grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div className="lg:sticky lg:top-[22vh] lg:self-start">
          <h2 id="problem-title" className="s-display s-h2">Your trading is spread across your week.</h2>
          <p className="s-lede mt-6">Your memory keeps the best parts. The rest decides your results.</p>
        </div>
        <ol className="flex flex-col">
          {PROBLEMS.map(([name, line]) => (
            <li key={name} className="problem-row border-t border-[var(--s-line)] py-7 last:border-b">
              <p className="relative inline-block font-[family-name:var(--s-font-display)] text-[clamp(1.5rem,2.6vw,2.3rem)] leading-tight font-semibold tracking-[-0.02em]">
                {name}
                <span aria-hidden className="problem-strike absolute top-[54%] left-0 h-[2px] w-full origin-left scale-x-0 bg-[var(--s-loss)] motion-reduce:hidden" />
              </p>
              <p className="s-body mt-2 text-[15.5px]">{line}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- Act 03: introducing Jarvis (authored near-silence, then a line draws itself) ---------- */

const PIPELINE = [
  ["Account data", "MT5 sync, file import, or entered by hand."],
  ["Trading journal", "One record: fills, costs, notes, screenshots, tags."],
  ["Analytics", "Figures worked out from your closed trades."],
  ["Insights", "Patterns and reviews over your own record."],
  ["Improvement", "A plan for tomorrow, checked against what you did."],
];

export function Introducing() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      const st = { trigger: ".intro-flow", start: "top 75%", end: "bottom 55%", scrub: 0.5 };
      gsap.fromTo(".intro-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, ease: "none", scrollTrigger: st });
      gsap.utils.toArray<HTMLElement>(".intro-node").forEach((n, i, all) => {
        gsap.fromTo(n, { opacity: 0.25 }, { opacity: 1, scrollTrigger: { trigger: ".intro-flow", start: () => `top+=${(i / all.length) * 100}% 75%`, end: () => `top+=${((i + 0.6) / all.length) * 100}% 65%`, scrub: true } });
      });
      gsap.from(".intro-statement", { opacity: 0, y: 30, ease: "power2.out", scrollTrigger: { trigger: ".intro-statement", start: "top 85%", end: "top 55%", scrub: true } });
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  return (
    <section id="introducing" data-sc-act="introducing" ref={root} className="relative py-[clamp(140px,24vh,280px)]" aria-labelledby="intro-title">
      <div className="s-wrap">
        <div className="intro-statement text-right">
          <h2 id="intro-title" className="s-display s-h2 ml-auto max-w-[18ch]">Jarvis gathers it into one record, and reads it for you.</h2>
        </div>
        <div className="intro-flow relative mt-24">
          <svg className="absolute top-[22px] left-0 hidden h-[2px] w-full lg:block" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden>
            <line x1="0" y1="1" x2="100" y2="1" stroke="var(--s-line-strong)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <line className="intro-line" x1="0" y1="1" x2="100" y2="1" stroke="var(--s-accent-strong)" strokeWidth="2" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset="0" />
          </svg>
          <ol className="grid gap-10 lg:grid-cols-5 lg:gap-6">
            {PIPELINE.map(([name, line], i) => (
              <li key={name} className="intro-node relative flex gap-5 lg:block">
                <span className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full border border-[var(--s-line-strong)] bg-[var(--s-canvas)] s-data text-[13px] text-[var(--s-ink)]">{i + 1}</span>
                <div className="lg:mt-6">
                  <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--s-ink)]">{name}</h3>
                  <p className="s-body mt-1.5 text-[15px]">{line}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------- Act 05: MT5 monitoring (a read-only connection, wiped into view) ---------- */

const READS = ["Closed trades and their deals", "Open positions", "Balance and equity", "Floating P&L on open trades", "Sync status, with the last good sync time"];
const NEVER = ["Place a trade", "Change a stop or a target", "Close a position", "Move money"];

export function Mt5() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      gsap.fromTo(".mt5-diagram", { clipPath: "inset(0 100% 0 0 round 16px)" }, { clipPath: "inset(0 0% 0 0 round 16px)", ease: "power2.out", scrollTrigger: { trigger: ".mt5-diagram", start: "top 80%", end: "top 40%", scrub: 0.4 } });
      // Data travels one way only, from the broker to Jarvis.
      gsap.to(".mt5-pulse", { attr: { cx: 100 }, duration: 2.4, ease: "power1.inOut", repeat: -1, stagger: 0.8 });
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  return (
    <section id="mt5" data-sc-act="mt5" ref={root} className="s-section" aria-labelledby="mt5-title">
      <div className="s-wrap grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <h2 id="mt5-title" className="s-display s-h2">Your MT5 account, read-only.</h2>
          <p className="s-lede mt-6">Connect with your account&apos;s investor password. It can read your history and positions. It cannot trade, and Jarvis never asks for your trading password.</p>
          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="s-label mb-3">Jarvis reads</h3>
              <ul className="flex flex-col gap-2.5">
                {READS.map((r) => (
                  <li key={r} className="flex items-start gap-3 text-[15px] text-[var(--s-ink)]">
                    <svg className="mt-1 shrink-0 text-[var(--s-profit)]" width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="s-label mb-3">The investor password can never</h3>
              <ul className="flex flex-col gap-2.5">
                {NEVER.map((r) => (
                  <li key={r} className="flex items-start gap-3 text-[15px] text-[var(--s-ink-soft)]">
                    <svg className="mt-1 shrink-0 text-[var(--s-loss)]" width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <figure className="m-0">
          <div className="mt5-diagram rounded-[var(--s-radius-lg)] border border-[var(--s-line-strong)] bg-[var(--s-surface)] p-6 shadow-[var(--s-shadow-2)] sm:p-10" role="img" aria-label="Diagram: your broker's MT5 server sends trades, positions and balances one way to Jarvis on your computer, through the read-only investor password.">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
              <div className="rounded-[var(--s-radius)] border border-[var(--s-line)] bg-[var(--s-raised)] p-4">
                <p className="s-label">Your broker</p>
                <p className="mt-1 text-[16px] font-semibold">MetaTrader 5</p>
                <p className="s-data mt-3 text-[12px] text-[var(--s-muted)]">history, positions, balance</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <svg width="120" height="24" viewBox="0 0 100 24" className="w-[64px] sm:w-[120px]" aria-hidden>
                  <line x1="0" y1="12" x2="100" y2="12" stroke="var(--s-line-strong)" strokeWidth="1.5" strokeDasharray="3 4" />
                  {[0, 1, 2].map((i) => <circle key={i} className="mt5-pulse" cx="0" cy="12" r="3" fill="var(--s-accent-strong)" />)}
                  <path d="M92 6l8 6-8 6" fill="none" stroke="var(--s-accent-strong)" strokeWidth="1.5" />
                </svg>
                <span className="flex items-center gap-1.5 rounded-full border border-[var(--s-line-strong)] px-2.5 py-1 text-[11.5px] text-[var(--s-ink-soft)]">
                  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden><rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                  read-only
                </span>
              </div>
              <div className="rounded-[var(--s-radius)] border border-[var(--s-accent)] bg-[var(--s-raised)] p-4">
                <p className="s-label">Your computer</p>
                <p className="mt-1 text-[16px] font-semibold">Jarvis</p>
                <p className="s-data mt-3 text-[12px] text-[var(--s-muted)]">synced on the interval you set</p>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3 border-t border-[var(--s-line)] pt-6 text-[13px]">
              {[["Sync", "Connected"], ["Data", "Fresh or marked stale"], ["Password", "Encrypted, on this computer"]].map(([k, v]) => (
                <div key={k}>
                  <p className="s-label text-[12px]">{k}</p>
                  <p className="mt-1 text-[var(--s-ink)]">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <figcaption className="s-caption">An illustration of the connection. Jarvis keeps the investor password encrypted on your computer and never shows it again.</figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ---------- Act 06: analytics (a pinned rail travelling sideways; a swipeable rail on touch) ---------- */

const PANELS: { key: ScreenKey; title: string; note: string }[] = [
  { key: "reportsOverview", title: "P&L by period, and the equity curve", note: "Day, week, month or year, from closed trades only." },
  { key: "calendarPage", title: "The trading calendar", note: "Each day's result, trade count and win rate." },
  { key: "reportsRisk", title: "Drawdown, risk and R-multiples", note: "Risk planned against risk taken." },
  { key: "reportsTime", title: "When you trade best", note: "Weekday and hour, in your own time zone." },
  { key: "playbooks", title: "Strategy performance", note: "Your playbooks side by side." },
  { key: "reportsInstruments", title: "Instrument performance", note: "Every symbol, side and asset class." },
];

export function Analytics() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        const track = root.current!.querySelector<HTMLElement>(".rail-track")!;
        const distance = () => track.scrollWidth - window.innerWidth + 64;
        gsap.to(track, { x: () => -distance(), ease: "none", scrollTrigger: { trigger: ".rail-pin", start: "top top", end: () => `+=${distance()}`, pin: true, scrub: 0.6, invalidateOnRefresh: true } });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  return (
    <section id="analytics" data-sc-act="analytics" ref={root} className="relative" aria-labelledby="analytics-title">
      <div className="rail-pin flex min-h-[100svh] flex-col justify-center overflow-hidden py-[88px]">
        <div className="s-wrap">
          <h2 id="analytics-title" className="s-display s-h2 max-w-[18ch]">Every figure, from your own closed trades.</h2>
        </div>
        <div className="mt-10 overflow-x-auto [scrollbar-width:none] max-lg:snap-x max-lg:snap-mandatory lg:overflow-visible" tabIndex={0} aria-label="Analytics screens, scroll sideways">
          <ol className="rail-track flex w-max gap-6 px-[var(--s-gutter)] will-change-transform">
            {PANELS.map((p) => {
              const s = SCREENS[p.key];
              const tall = s.h / s.w > 0.8;
              return (
                <li key={p.key} className={cx("shrink-0 snap-start", tall ? "w-[min(78vw,340px)] lg:w-[340px]" : "w-[min(86vw,600px)] lg:w-[600px]")}>
                  <div className="s-frame">
                    <Image src={s.src} width={s.w} height={s.h} alt={s.alt} unoptimized className="h-auto w-full" sizes="(min-width: 1024px) 600px, 86vw" />
                  </div>
                  <h3 className="mt-4 text-[17px] font-semibold text-[var(--s-ink)]">{p.title}</h3>
                  <p className="s-body mt-1 text-[14.5px]">{p.note}</p>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="s-wrap s-caption mt-6">{SAMPLE_NOTE}</p>
      </div>
    </section>
  );
}

/* ---------- Act 07: psychology (the record, not the mind; rule by rule) ---------- */

const RULES: [string, string, string][] = [
  ["Revenge trading", "Fast re-entry after a loss", "A new trade opens on the same account within 15 minutes of a losing trade closing."],
  ["Emotional sizing", "Larger risk after a loss", "Planned risk is at least 1.5 times the previous trade's, right after a loss."],
  ["Overtrading", "Results on unusually busy days", "Days with more than twice your median number of trades, compared with the rest."],
  ["Strategy violations", "Off-plan trades cost more", "Trades you marked as off-plan, compared with the ones that followed it."],
  ["Risk management", "Losses larger than planned", "A losing trade with a stop that finishes beyond −1.2R."],
  ["Fear of giving it back", "Winners closed well before target", "A winner closed at less than half of its planned reward."],
  ["Hope", "Losers held longer than winners", "Losing trades held at least 1.5 times as long as winners."],
];

export function Psychology() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      gsap.from(".psy-word", { opacity: 0.12, stagger: 0.25, ease: "none", scrollTrigger: { trigger: ".psy-title", start: "top 80%", end: "bottom 45%", scrub: true } });
      gsap.utils.toArray<HTMLElement>(".psy-rule").forEach((r) => gsap.from(r, { opacity: 0, y: 18, ease: "power2.out", scrollTrigger: { trigger: r, start: "top 88%", end: "top 70%", scrub: true } }));
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  const title = "Jarvis doesn't read your mind. It reads your record.";
  return (
    <section id="psychology" data-sc-act="psychology" ref={root} className="s-section" aria-labelledby="psy-title">
      <div className="s-wrap">
        <h2 id="psy-title" className="psy-title s-display s-h2 ml-auto max-w-[18ch] text-right">
          {title.split(" ").map((w, i) => (
            <span key={i} className="psy-word">{w} </span>
          ))}
        </h2>
        <p className="s-lede mt-6 ml-auto text-right">You tag emotions, mistakes and whether you followed your plan. Jarvis checks your results against them with plain rules you can read.</p>
        <ol className="mt-16 grid gap-px overflow-hidden rounded-[var(--s-radius-lg)] border border-[var(--s-line)] bg-[var(--s-line)] lg:grid-cols-2">
          {RULES.map(([topic, name, rule]) => (
            <li key={name} className="psy-rule bg-[var(--s-canvas)] p-6 sm:p-8">
              <p className="s-label">{topic}</p>
              <h3 className="mt-2 text-[19px] font-semibold tracking-[-0.01em] text-[var(--s-ink)]">{name}</h3>
              <p className="s-body mt-2 text-[15px]">{rule}</p>
            </li>
          ))}
          <li className="psy-rule bg-[var(--s-canvas)] p-6 sm:p-8">
            <p className="s-body text-[15px]">These are checks over your own trades, shown only when there are enough of them. They describe what happened. They don&apos;t diagnose anyone, and they aren&apos;t advice.</p>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ---------- Act 08: what comes next (a depth deck that answers the pointer) ---------- */

const NEXT: { title: string; body: string; kind: "built" | "soon" | "needs-ai"; motif: "bars" | "replay" | "chat" | "bias" | "review" | "people" | "book" | "library" }[] = [
  { title: "Backtesting", body: "Trade a past session on your broker's real bars, one bar at a time. Stops are checked first when a bar touches both levels.", kind: "built", motif: "bars" },
  { title: "Trade Replay", body: "Replay a trade or a whole day with your own fills on the chart.", kind: "built", motif: "replay" },
  { title: "AI Coach", body: "Ask about your own record. It works when you connect an AI model, and it is not a signal service.", kind: "needs-ai", motif: "chat" },
  { title: "Market context", body: "A bias for each instrument you follow, with the factors behind it, and the economic calendar you import.", kind: "built", motif: "bias" },
  { title: "Reviews", body: "A weekly and monthly review built from the figures, with an optional written summary.", kind: "built", motif: "review" },
  // Named in the app's sidebar as coming. What they will contain isn't decided, so the site doesn't describe it.
  { title: "Mentor Mode", body: "Planned. Not in Jarvis yet.", kind: "soon", motif: "people" },
  { title: "University", body: "Planned. Not in Jarvis yet.", kind: "soon", motif: "book" },
  { title: "Resource Center", body: "Planned. Not in Jarvis yet.", kind: "soon", motif: "library" },
];

function Motif({ m }: { m: (typeof NEXT)[number]["motif"] }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width="56" height="40" viewBox="0 0 56 40" aria-hidden className="text-[var(--s-accent-strong)]">
      {m === "bars" && [6, 14, 22, 30, 38, 46].map((x, i) => <g key={x}><line x1={x} y1={8 + (i % 3) * 3} x2={x} y2={32 - (i % 2) * 4} {...stroke} /><rect x={x - 3} y={14 + ((i * 5) % 9)} width="6" height={8 + (i % 3) * 2} rx="1" fill={i % 2 ? "var(--s-loss)" : "var(--s-profit)"} /></g>)}
      {m === "replay" && <><path d="M4 30l10-8 8 4 10-12 10 6 10-10" {...stroke} /><circle cx="22" cy="26" r="3" fill="var(--s-profit)" /><circle cx="42" cy="20" r="3" fill="var(--s-loss)" /></>}
      {m === "chat" && <><rect x="4" y="6" width="34" height="20" rx="5" {...stroke} /><path d="M12 26l-4 7 9-7" {...stroke} /><rect x="24" y="16" width="28" height="16" rx="5" {...stroke} /></>}
      {m === "bias" && <><path d="M6 32a22 22 0 0 1 44 0" {...stroke} /><line x1="28" y1="32" x2="40" y2="16" {...stroke} /><circle cx="28" cy="32" r="2.5" fill="currentColor" /></>}
      {m === "review" && <><rect x="6" y="4" width="30" height="34" rx="3" {...stroke} /><path d="M12 14h18M12 21h18M12 28h10" {...stroke} /><path d="M38 24l5 5 9-12" {...stroke} /></>}
      {m === "people" && <><circle cx="20" cy="14" r="6" {...stroke} /><path d="M8 34c0-7 5-11 12-11s12 4 12 11" {...stroke} /><circle cx="40" cy="16" r="5" {...stroke} /><path d="M36 25c7 0 12 3 12 9" {...stroke} /></>}
      {m === "book" && <><path d="M28 10c-6-4-14-4-22-2v24c8-2 16-2 22 2 6-4 14-4 22-2V8c-8-2-16-2-22 2z" {...stroke} /><path d="M28 10v24" {...stroke} /></>}
      {m === "library" && <><rect x="6" y="6" width="8" height="28" rx="1" {...stroke} /><rect x="17" y="10" width="8" height="24" rx="1" {...stroke} /><path d="M29 12l7-2 7 24-7 2z" {...stroke} /></>}
    </svg>
  );
}

export function Next() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      gsap.from(".next-card", { y: 60, opacity: 0, stagger: 0.06, ease: "power3.out", scrollTrigger: { trigger: ".next-deck", start: "top 85%", end: "top 40%", scrub: 0.5 } });
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );
  // The deck leans toward a fine pointer, each card at its own depth.
  const tilt = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateZ(6px)`;
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const reset = (e: React.PointerEvent<HTMLElement>) => (e.currentTarget.style.transform = "");
  return (
    <section id="next" data-sc-act="next" ref={root} className="s-section" aria-labelledby="next-title">
      <div className="s-wrap grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="lg:sticky lg:top-[20vh] lg:self-start">
          <h2 id="next-title" className="s-display s-h2">Practice, review, and what is still being built.</h2>
          <p className="s-lede mt-6">Everything here is marked: in Jarvis today, or in development.</p>
          <Link href="/features" className="s-btn s-btn-ghost mt-8">See every feature</Link>
        </div>
        <ul className="next-deck grid gap-4 sm:grid-cols-2">
          {NEXT.map((n) => (
            <li key={n.title} className="next-card">
              <article onPointerMove={tilt} onPointerLeave={reset} className="s-frame h-full p-6 transition-transform duration-300 ease-[var(--s-ease-out)] will-change-transform" data-kind={n.kind}>
                <div className="flex items-start justify-between gap-3">
                  <Motif m={n.motif} />
                  <Status kind={n.kind} />
                </div>
                <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.01em] text-[var(--s-ink)]">{n.title}</h3>
                <p className="s-body mt-2 text-[14.5px]">{n.body}</p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
