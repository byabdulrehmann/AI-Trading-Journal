"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useStored } from "@/lib/client/use-stored";
import { PUBLIC_PAGES, useApp } from "@/lib/client/app-state";
import { useFetch } from "@/lib/client/use-fetch";
import type { Notification } from "@/app/api/notifications/route";
import { CommandPalette } from "./CommandPalette";
import { Dropdown, ICONS, Icon } from "./Dropdown";
import { cx } from "./ui";
import { JarvisPanel } from "./jarvis/JarvisPanel";
import { TradeDrawer } from "./journal/TradeDrawer";
import { TradeFormDialog } from "./journal/TradeForm";
import { Toasts } from "./Toasts";

interface NavItem {
  href: string | null;
  label: string;
  icon: string;
  badge?: string;
}

/** Navigation groups. A null href is a module that isn't built: shown, marked, never a link. */
const GROUPS: NavItem[][] = [
  [
    { href: "/", label: "Dashboard", icon: ICONS.dashboard },
    { href: "/day", label: "Daily Journal", icon: ICONS.journal },
    { href: "/journal", label: "Trades", icon: ICONS.trades },
    { href: "/notebook", label: "Notebook", icon: ICONS.notebook },
    { href: "/progress", label: "Progress Tracker", icon: ICONS.progress, badge: "NEW" },
  ],
  [
    { href: "/playbooks", label: "Playbook", icon: ICONS.playbook },
    { href: "/analytics", label: "Reports", icon: ICONS.reports },
  ],
  [
    { href: "/backtest", label: "Backtesting", icon: ICONS.backtest },
    { href: "/replay", label: "Trade Replay", icon: ICONS.replay },
    { href: null, label: "Mentor Mode", icon: ICONS.mentor },
    { href: null, label: "University", icon: ICONS.university },
    { href: null, label: "Resource Center", icon: ICONS.resources },
  ],
  [
    { href: "/calendar", label: "Calendar", icon: ICONS.calendar },
    { href: "/patterns", label: "Patterns", icon: ICONS.patterns },
    { href: "/market", label: "Market context", icon: ICONS.market },
    { href: "/news", label: "Economic calendar", icon: ICONS.news },
    { href: "/jarvis", label: "AI Coach", icon: ICONS.coach },
    { href: "/accounts", label: "Accounts & MT5", icon: ICONS.accounts },
    { href: "/settings", label: "Settings", icon: ICONS.settings },
  ],
];

const isActive = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function pageTitle(pathname: string): string {
  for (const item of GROUPS.flat()) if (item.href && isActive(item.href, pathname)) return item.label;
  return "Jarvis";
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden fill="none">
        <rect width="26" height="26" rx="8" fill="var(--ink)" />
        <path d="M6 16.5l4.5-5 3.5 3 6-7" stroke="var(--canvas)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="7.5" r="1.6" fill="var(--accent)" />
      </svg>
      {!compact && <span className="text-[17px] font-semibold tracking-tight">Jarvis</span>}
    </span>
  );
}

const NAV_KEY = "jarvis-nav";

/** Remembered per browser. The layout's script sets the attribute before paint, so there's no jump. */
function useCollapsed(): [boolean, () => void] {
  const [value, set] = useStored(NAV_KEY, "open");
  const collapsed = value === "collapsed";
  const toggle = () => {
    if (collapsed) delete document.documentElement.dataset.nav;
    else document.documentElement.dataset.nav = "collapsed";
    set(collapsed ? "open" : "collapsed");
  };
  return [collapsed, toggle];
}

function NavLink({ item, pathname, onGo }: { item: NavItem; pathname: string; onGo: () => void }) {
  const body = (
    <>
      <Icon d={item.icon} size={17} className={item.href ? "text-nav-ink" : "text-nav-muted"} />
      <span className="truncate lg:navmin:sr-only">{item.label}</span>
      {item.badge && <span className="shrink-0 rounded-[3px] bg-accent px-1 py-px text-[8.5px] leading-[11px] font-bold text-accent-ink lg:navmin:hidden">{item.badge}</span>}
      {!item.href && <span className="ml-auto shrink-0 rounded-[3px] bg-nav-active px-1 py-px text-[9.5px] leading-[12px] text-nav-muted lg:navmin:hidden">Soon</span>}
      <span role="tooltip" className="pointer-events-none absolute top-1/2 left-full z-[var(--z-modal)] ml-3 hidden -translate-y-1/2 rounded-control bg-ink px-2 py-1 text-[12px] whitespace-nowrap text-surface lg:navmin:group-hover:block lg:navmin:group-focus-visible:block">
        {item.label}{item.href ? "" : ", coming soon"}
      </span>
    </>
  );
  const base = "group relative flex h-8 items-center gap-2 rounded-control px-2 text-[13px] font-medium lg:navmin:justify-center lg:navmin:px-0";
  if (!item.href) {
    return (
      <span aria-disabled="true" tabIndex={0} title={`${item.label}: coming soon`} className={cx(base, "cursor-default text-nav-muted")} data-testid="nav-soon">
        {body}
      </span>
    );
  }
  const active = isActive(item.href, pathname);
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} onClick={onGo} className={cx(base, active ? "neu bg-nav-active font-semibold text-ink" : "text-nav-ink hover:bg-nav-active/60 hover:text-ink")}>
      {body}
    </Link>
  );
}

function Bell() {
  const { data } = useFetch<{ notifications: Notification[] }>("/api/notifications");
  const items = data?.notifications ?? [];
  return (
    <Dropdown
      label={items.length ? `Notifications, ${items.length}` : "Notifications"}
      className="neu relative grid size-[38px] place-items-center rounded-full bg-surface text-ink-soft hover:text-ink"
      panelClassName="w-80 max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:w-auto"
      button={
        <>
          <Icon d={ICONS.bell} size={18} />
          {items.length > 0 && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-loss px-1 text-[10px] leading-4 font-semibold text-white">{items.length}</span>}
        </>
      }
    >
      {(close) => (
        <div data-testid="notifications">
          <p className="mb-2 text-[13px] font-semibold text-ink">Notifications</p>
          {items.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing needs your attention. Challenge limits, MT5 sync problems and trades left out of your figures show up here.</p>
          ) : (
            <ul className="-mx-1 max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} onClick={close} className="flex gap-2.5 rounded-control px-1 py-2 hover:bg-raised">
                    <span aria-hidden className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.tone === "loss" ? "bg-loss" : n.tone === "warn" ? "bg-warn" : "bg-info")} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                      <span className="block text-[12.5px] text-muted">{n.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dropdown>
  );
}

/** Flips between pearl and obsidian and saves it as the Theme setting, so Settings and every device stay in step. */
function ThemeSwitch() {
  const { settings, saveSettings } = useApp();
  if (!settings) return null;
  const dark = settings.theme === "dark" || (settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => void saveSettings({ theme: dark ? "light" : "dark" })}
      aria-pressed={dark}
      aria-label={dark ? "Dark theme on. Switch to light" : "Light theme on. Switch to dark"}
      title={dark ? "Light theme" : "Dark theme"}
      className="neu grid size-[38px] place-items-center rounded-full bg-surface text-ink-soft hover:text-ink"
      data-testid="app-theme-toggle"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
        {dark ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
          </>
        )}
      </svg>
    </button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { jarvisOpen, setJarvisOpen, settings, editTrade, user, signOut } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, toggle] = useCollapsed();

  if (PUBLIC_PAGES.has(pathname)) {
    return (
      <>
        {children}
        <Toasts />
      </>
    );
  }

  const coachEnabled = settings?.jarvis.enabled ?? true;
  const close = () => setNavOpen(false);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside
        className={cx(
          "glass-bar fixed inset-y-0 left-0 z-40 w-[214px] flex-col border-r border-[var(--nav-line)] bg-gradient-to-b from-nav to-[var(--nav-bg-end)] text-nav-ink lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[196px] lg:shrink-0 lg:navmin:w-14",
          navOpen ? "flex" : "hidden",
        )}
        aria-label="Primary"
      >
        <div className="relative flex h-[62px] shrink-0 items-center px-4 lg:navmin:justify-center lg:navmin:px-0">
          <Link href="/" aria-label="Jarvis home" onClick={close} className="text-nav-ink">
            <span className="lg:navmin:hidden"><Logo /></span>
            <span className="hidden lg:navmin:inline"><Logo compact /></span>
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
            aria-pressed={collapsed}
            className="absolute top-1/2 -right-[13px] z-10 hidden size-[26px] -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-ink shadow-card hover:bg-raised lg:grid"
          >
            <Icon d={collapsed ? ICONS.right : ICONS.left} size={14} />
          </button>
        </div>
        <div className="px-2 pb-3 lg:navmin:px-2">
          <button
            type="button"
            onClick={() => {
              close();
              editTrade("new");
            }}
            className="flex h-[34px] w-full items-center gap-2.5 rounded-control bg-accent px-3 text-[13px] font-semibold text-accent-ink shadow-[0_10px_22px_-12px_var(--accent)] hover:bg-accent/90 lg:navmin:justify-center lg:navmin:px-0"
            aria-label="Add trade"
          >
            <Icon d={ICONS.plus} size={16} />
            <span className="lg:navmin:sr-only">Add Trade</span>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
          {GROUPS.map((group, i) => (
            <div key={i} className={cx("space-y-0.5", i > 0 && "mt-3", i === GROUPS.length - 1 && "border-t border-[var(--nav-line)] pt-3")}>
              {group.map((item) => <NavLink key={item.label} item={item} pathname={pathname} onGo={close} />)}
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--nav-line)] p-3 lg:navmin:px-1">
          {user && <p className="truncate px-1 text-[12.5px] text-nav-muted lg:navmin:hidden" title={user.email}>{user.name || user.email}</p>}
          <button type="button" className="mt-1 w-full rounded-control px-1 py-1 text-left text-[13px] text-nav-ink hover:bg-nav-active lg:navmin:text-center lg:navmin:text-[11px]" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" onClick={close} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex min-h-[62px] flex-wrap items-center gap-x-2 gap-y-2 glass-bar border-b border-line bg-glass px-4 py-2.5 sm:px-6">
          <button type="button" className="grid size-9 place-items-center rounded-control text-ink-soft hover:bg-raised lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
            <Icon d={ICONS.menu} size={18} />
          </button>
          <p className="mr-auto truncate font-[family-name:var(--font-head)] text-[21px] font-medium tracking-[-0.03em] text-ink" data-testid="page-title">{pageTitle(pathname)}</p>
          <div id="topbar-slot" className="flex flex-wrap items-center gap-2 max-md:order-last max-md:w-full" />
          <div className="flex items-center gap-2">
            {coachEnabled && (
              <button type="button" aria-expanded={jarvisOpen} aria-controls="jarvis-panel" onClick={() => setJarvisOpen(!jarvisOpen)} title="AI Coach" aria-label="AI Coach" className="neu grid size-[38px] place-items-center rounded-full bg-surface text-ink-soft hover:text-ink">
                <Icon d={ICONS.coach} size={18} />
              </button>
            )}
            <ThemeSwitch />
            <Bell />
          </div>
        </header>
        <div className="flex min-w-0 flex-1">
          <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-[22px]">
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
