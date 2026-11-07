"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PUBLIC_PAGES, useApp } from "@/lib/client/app-state";
import { CommandPalette } from "./CommandPalette";
import { Button, cx } from "./ui";
import { JarvisPanel } from "./jarvis/JarvisPanel";
import { TradeDrawer } from "./journal/TradeDrawer";
import { TradeFormDialog } from "./journal/TradeForm";
import { Toasts } from "./Toasts";

const NAV = [
  { href: "/", label: "Dashboard", icon: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z" },
  { href: "/journal", label: "Journal", icon: "M6 4h12v16H6zM9.5 9h5M9.5 13h5" },
  { href: "/day", label: "Daily journal", icon: "M5 4h14v16H5zM9 4v16M12 9h4M12 13h4" },
  { href: "/playbooks", label: "Playbooks", icon: "M6 3h12v18l-6-4-6 4zM10 8h4M10 12h4" },
  { href: "/notebook", label: "Notebook", icon: "M5 3h14v18H5zM9 3v18M12 8h4M12 12h4" },
  { href: "/replay", label: "Replay", icon: "M6 4l13 8-13 8z" },
  { href: "/calendar", label: "Calendar", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/analytics", label: "Reports", icon: "M4 20V11M10 20V5M16 20v-6M3 20h18" },
  { href: "/patterns", label: "Patterns", icon: "M4 16l5-5 4 4 7-8" },
  { href: "/market", label: "Market context", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { href: "/jarvis", label: "AI Coach", icon: "M4 5h16v11H9l-5 4zM9 10.5h.01M15 10.5h.01" },
  { href: "/accounts", label: "Accounts & MT5", icon: "M3 7h18v12H3zM3 11h18M7 15h3" },
  { href: "/settings", label: "Settings", icon: "M5 7h14M5 12h14M5 17h14M9 5v4M15 10v4M8 15v4" },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none">
        <path d="M1 12.5h3.5V7.5H8v6h3.5V4H15" stroke="var(--ink)" strokeWidth="1.5" />
        <rect x="14" y="2.5" width="3" height="3" fill="var(--accent)" />
      </svg>
      <span className="text-[16px] font-medium tracking-tight text-ink">Jarvis</span>
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { jarvisOpen, setJarvisOpen, settings, editTrade, user, signOut } = useApp();
  const [navOpen, setNavOpen] = useState(false);

  if (PUBLIC_PAGES.has(pathname)) {
    return (
      <>
        {children}
        <Toasts />
      </>
    );
  }

  const coachEnabled = settings?.jarvis.enabled ?? true;

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-52 flex-col border-r border-line bg-canvas lg:sticky lg:top-0 lg:flex lg:h-dvh lg:shrink-0",
          navOpen ? "flex" : "hidden",
        )}
        aria-label="Primary"
      >
        <div className="flex h-13 shrink-0 items-center px-4">
          <Link href="/" aria-label="Jarvis home" onClick={() => setNavOpen(false)}>
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-px overflow-y-auto px-2 py-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setNavOpen(false)}
                className={cx(
                  "flex items-center gap-2.5 px-2.5 py-1.5 text-[14px] transition-colors",
                  active ? "bg-raised text-ink shadow-[inset_2px_0_0_var(--accent)]" : "text-ink-soft hover:bg-raised hover:text-ink",
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden className="text-muted">
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line p-3">
          {user && <p className="truncate px-1 text-[13px] text-ink-soft" title={user.email}>{user.name || user.email}</p>}
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start !px-1" onClick={() => void signOut()}>
            Sign out
          </Button>
          <p className="mt-2 px-1 text-[12px] leading-snug text-muted">A journal, not advice. Jarvis never places trades.</p>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-line bg-canvas px-gutter sm:px-6">
          <Button variant="ghost" size="sm" className="px-2 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2 4.5h14M2 9h14M2 13.5h14" /></svg>
          </Button>
          <span className="lg:hidden">
            <Logo />
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[13px] text-muted sm:inline">
              <kbd>Ctrl</kbd> <kbd>K</kbd> to go anywhere
            </span>
            <Button size="sm" variant="primary" onClick={() => editTrade("new")}>
              Log trade
            </Button>
            {coachEnabled && (
              <Button size="sm" aria-expanded={jarvisOpen} aria-controls="jarvis-panel" onClick={() => setJarvisOpen(!jarvisOpen)}>
                AI Coach
              </Button>
            )}
          </div>
        </header>
        <div className="flex min-w-0 flex-1">
          <main id="main" className="min-w-0 flex-1 px-gutter py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[var(--container)]">{children}</div>
          </main>
          {coachEnabled && jarvisOpen && pathname !== "/jarvis" && <JarvisPanel onClose={() => setJarvisOpen(false)} />}
        </div>
      </div>

      <TradeDrawer />
      <TradeFormDialog />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
