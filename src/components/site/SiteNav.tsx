"use client";

import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useSound } from "./sound";
import { useReducedMotion } from "./scroll";

export const CTA_LABEL = "Experience Jarvis";
export const CTA_HREF = "/contact#early-access";

const PLATFORM = [
  { href: "/platform", label: "Overview", note: "How Jarvis fits a trader's day" },
  { href: "/platform#mt5", label: "MT5, read-only", note: "What the investor password can and can't do" },
  { href: "/platform#private", label: "Private and local", note: "Where your trading data lives" },
  { href: "/platform#technology", label: "Technology", note: "What it is built with" },
];
const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

/** The Jarvis mark: the app's rising-line glyph, in metal for the dark ground. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden fill="none">
      <rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="url(#mark-fill)" stroke="rgb(255 255 255 / 0.18)" />
      <path d="M6 16.5l4.5-5 3.5 3 6-7" style={{ stroke: "var(--s-accent-ink)" }} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="7.5" r="1.7" style={{ fill: "var(--s-accent-ink)" }} />
      <defs>
        <linearGradient id="mark-fill" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop style={{ stopColor: "var(--s-accent-strong)" }} />
          <stop offset="1" style={{ stopColor: "var(--s-accent)" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/welcome" className="flex items-center gap-2.5 text-[var(--s-ink)] no-underline" aria-label="Jarvis home">
      <Mark />
      <span className="font-[family-name:var(--s-font-display)] text-[19px] font-semibold tracking-[-0.02em]">Jarvis</span>
    </Link>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {on ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
    </svg>
  );
}

/** Sound on/off plus a volume slider. Off until the visitor turns it on. */
export function SoundControl({ compact }: { compact?: boolean }) {
  const { enabled, setEnabled, volume, setVolume, play } = useSound();
  const id = useId();
  return (
    <div className="flex items-center gap-2" data-testid="sound-control">
      <button
        type="button"
        aria-pressed={enabled}
        aria-label={enabled ? "Sound on. Turn sound off" : "Sound off. Turn sound on"}
        onClick={() => {
          setEnabled(!enabled);
          if (!enabled) setTimeout(() => play("power"), 60);
        }}
        className={cx("grid size-10 place-items-center rounded-full border transition-colors", enabled ? "border-[var(--s-accent)] text-[var(--s-accent-strong)]" : "border-[var(--s-line-strong)] text-[var(--s-ink-soft)] hover:text-[var(--s-ink)]")}
      >
        <SpeakerIcon on={enabled} />
      </button>
      {enabled && (
        <span className={cx("items-center gap-2", compact ? "flex" : "hidden xl:flex")}>
          <label htmlFor={id} className="sr-only">Volume</label>
          <input id={id} type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 w-20 accent-[var(--s-accent)]" aria-valuetext={`${Math.round(volume * 100)}%`} data-testid="volume" />
        </span>
      )}
    </div>
  );
}

/** A soft pill that slides between nav items as the pointer moves across them. */
function HoverPill() {
  const reduced = useReducedMotion();
  return <motion.span layoutId="nav-hover" aria-hidden className="absolute inset-y-1 inset-x-0 -z-10 rounded-full bg-[rgb(255_255_255/0.06)]" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 42 }} />;
}

function PlatformMenu({ active, hovered, onHover }: { active: boolean; hovered: boolean; onHover: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <li ref={box} className="relative" onMouseEnter={() => (onHover(), matchMedia("(hover: hover)").matches && setOpen(true))} onMouseLeave={() => matchMedia("(hover: hover)").matches && setOpen(false)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={cx("relative isolate flex h-10 items-center gap-1.5 px-3 text-[14.5px] transition-colors", active || open ? "text-[var(--s-ink)]" : "text-[var(--s-ink-soft)] hover:text-[var(--s-ink)]")}>
        Platform
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cx("transition-transform duration-200", open && "rotate-180")}><path d="M1.5 3.5L5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        {active && <motion.span layoutId="nav-indicator" className="absolute inset-x-3 -bottom-0.5 h-px bg-[var(--s-accent-strong)]" />}
        {hovered && <HoverPill />}
      </button>
      <div id={id} hidden={!open} className="absolute top-full left-0 pt-2">
        <ul className="w-[300px] rounded-[var(--s-radius-lg)] border border-[var(--s-line-strong)] bg-[var(--s-surface)] p-2 shadow-[var(--s-shadow-2)]">
          {PLATFORM.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={() => setOpen(false)} className="block rounded-[var(--s-radius)] px-3 py-2.5 no-underline transition-colors hover:bg-[var(--s-raised)]">
                <span className="block text-[14.5px] font-medium text-[var(--s-ink)]">{l.label}</span>
                <span className="block text-[13px] text-[var(--s-muted)]">{l.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function SiteNav({ chapters }: { chapters?: { id: string; label: string }[] }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const last = useRef(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      // How far through the page: a hairline under the bar.
      bar.current?.style.setProperty("transform", `scaleX(${Math.min(1, y / Math.max(1, document.documentElement.scrollHeight - innerHeight))})`);
      setScrolled(y > 24);
      // Steps aside while the visitor reads downward, returns the moment they scroll up.
      setHidden(y > 640 && y > last.current + 4 && !menu);
      if (y < last.current - 4 || y < 640) setHidden(false);
      last.current = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", esc);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.documentElement.style.overflow = "";
    };
  }, [menu]);

  const isActive = (href: string) => pathname === href;
  return (
    <header
      className={cx(
        "fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color] duration-300",
        scrolled ? "border-b border-[var(--s-line)] bg-[rgb(7_8_13/0.86)]" : "border-b border-transparent",
        hidden && !reduced ? "-translate-y-full" : "translate-y-0",
      )}
      data-testid="site-nav"
    >
      <a href="#site-main" className="skip-link">Skip to content</a>
      <nav aria-label="Main" className="s-wrap flex h-[72px] items-center gap-4">
        <Wordmark />
        <LayoutGroup>
          <ul className="ml-6 hidden items-center lg:flex" onMouseLeave={() => setHover(null)}>
            <PlatformMenu active={pathname === "/platform"} hovered={hover === "/platform"} onHover={() => setHover("/platform")} />
            {LINKS.map((l) => (
              <li key={l.href} onMouseEnter={() => setHover(l.href)}>
                <Link href={l.href} aria-current={isActive(l.href) ? "page" : undefined} className={cx("relative isolate flex h-10 items-center px-3 text-[14.5px] no-underline transition-colors", isActive(l.href) ? "text-[var(--s-ink)]" : "text-[var(--s-ink-soft)] hover:text-[var(--s-ink)]")}>
                  {l.label}
                  {isActive(l.href) && <motion.span layoutId="nav-indicator" className="absolute inset-x-3 -bottom-0.5 h-px bg-[var(--s-accent-strong)]" />}
                  {hover === l.href && <HoverPill />}
                </Link>
              </li>
            ))}
          </ul>
        </LayoutGroup>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:block"><SoundControl /></span>
          <Link href="/login" className="hidden h-10 items-center px-3 text-[14.5px] text-[var(--s-ink-soft)] no-underline transition-colors hover:text-[var(--s-ink)] md:flex">Sign in</Link>
          <Link href={CTA_HREF} className="s-btn s-btn-primary hidden h-10! px-5! text-[14px]! sm:inline-flex">{CTA_LABEL}</Link>
          <button type="button" className="grid size-10 place-items-center rounded-full border border-[var(--s-line-strong)] text-[var(--s-ink)] lg:hidden" aria-expanded={menu} aria-controls="site-menu" aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((m) => !m)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>{menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}</svg>
          </button>
        </div>
      </nav>
      <div id="site-menu" hidden={!menu} className="fixed inset-x-0 top-[72px] bottom-0 overflow-y-auto border-t border-[var(--s-line)] bg-[var(--s-canvas)] lg:hidden" data-testid="site-menu">
        <div className="s-wrap flex flex-col gap-8 py-8">
          <ul className="flex flex-col">
            {[...PLATFORM.slice(0, 1).map((l) => ({ ...l, label: "Platform" })), ...LINKS, { href: "/login", label: "Sign in" }].map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setMenu(false)} className="flex h-14 items-center border-b border-[var(--s-line)] font-[family-name:var(--s-font-display)] text-[26px] font-semibold tracking-[-0.02em] text-[var(--s-ink)] no-underline">{l.label}</Link>
              </li>
            ))}
          </ul>
          {chapters && (
            <div>
              <p className="s-label mb-2">On this page</p>
              <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {chapters.map((c, i) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} onClick={() => setMenu(false)} className="flex min-h-11 items-center gap-3 text-[15px] text-[var(--s-ink-soft)] no-underline hover:text-[var(--s-ink)]">
                      <span className="s-data text-[12px] text-[var(--s-muted)]">{String(i + 1).padStart(2, "0")}</span>
                      {c.label}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <Link href={CTA_HREF} onClick={() => setMenu(false)} className="s-btn s-btn-primary">{CTA_LABEL}</Link>
            <SoundControl compact />
          </div>
        </div>
      </div>
      <div ref={bar} aria-hidden className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-[linear-gradient(90deg,transparent,var(--s-accent-strong))]" />
    </header>
  );
}
