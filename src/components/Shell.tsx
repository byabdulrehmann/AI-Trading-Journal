"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/lib/client/app-state";
import { Button, cx } from "./ui";
import { JarvisPanel } from "./jarvis/JarvisPanel";
import { TradeDrawer } from "./journal/TradeDrawer";
import { TradeFormDialog } from "./journal/TradeForm";
import { Toasts } from "./Toasts";

const NAV = [
  { href: "/", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/journal", label: "Journal", icon: "M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4" },
  { href: "/analytics", label: "Analytics", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/patterns", label: "Patterns", icon: "M4 17l5-5 4 4 7-8M15 8h5v5" },
  { href: "/market", label: "Market context", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { href: "/jarvis", label: "Jarvis", icon: "M12 3a6 6 0 016 6c0 4-6 12-6 12S6 13 6 9a6 6 0 016-6zM12 7v4" },
  { href: "/settings", label: "Settings", icon: "M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h2M19 12h2M12 3v2M12 19v2" },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent-soft)" />
        <path d="M6 19c5-1 8-4 10-10 1 5 4 8 10 9-6 1-9 3-10 7-1-4-4-6-10-6z" fill="var(--accent)" />
      </svg>
      <span className="text-[16px] font-semibold tracking-tight text-ink">Kestrel</span>
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { jarvisOpen, setJarvisOpen, settings, editTrade } = useApp();
  const [navOpen, setNavOpen] = useState(false);

  const jarvisEnabled = settings?.jarvis.enabled ?? true;

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-line bg-surface lg:static lg:flex",
          navOpen ? "flex" : "hidden",
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 items-center px-5">
          <Link href="/" aria-label="Kestrel home">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setNavOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors",
                  active ? "bg-raised text-ink ring-1 ring-line" : "text-ink-soft hover:bg-raised/60 hover:text-ink",
                )}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={active ? "text-accent" : "text-muted"}>
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-4 text-[12px] leading-relaxed text-muted">
          Educational journaling tool. Not financial advice. Kestrel never places trades.
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/90 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            ☰
          </Button>
          <span className="lg:hidden">
            <Logo />
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => editTrade("new")}>
              + Log trade
            </Button>
            {jarvisEnabled && (
              <Button size="sm" variant={jarvisOpen ? "primary" : "secondary"} aria-expanded={jarvisOpen} aria-controls="jarvis-panel" onClick={() => setJarvisOpen(!jarvisOpen)}>
                Jarvis
              </Button>
            )}
          </div>
        </header>
        <div className="flex min-w-0 flex-1">
          <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </main>
          {jarvisEnabled && jarvisOpen && pathname !== "/jarvis" && <JarvisPanel onClose={() => setJarvisOpen(false)} />}
        </div>
      </div>

      <TradeDrawer />
      <TradeFormDialog />
      <Toasts />
    </div>
  );
}
