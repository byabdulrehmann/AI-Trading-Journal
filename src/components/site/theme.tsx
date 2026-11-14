"use client";

import { useSyncExternalStore } from "react";

export type SiteTheme = "light" | "dark";
import { SITE_THEME_KEY as KEY } from "./boot-scripts";

const EVENT = "jarvis-site-theme";
// The mode is set before the first paint by SITE_THEME_SCRIPT in the root layout, so a returning visitor never sees the other mode flash.

const read = (): SiteTheme => (document.documentElement.dataset.siteTheme === "light" ? "light" : "dark");
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

function apply(t: SiteTheme) {
  document.documentElement.dataset.siteTheme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Private windows can refuse storage; the choice still holds for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSiteTheme(): [SiteTheme, (t: SiteTheme, from?: { x: number; y: number }) => void] {
  const theme = useSyncExternalStore<SiteTheme>(subscribe, read, () => "dark");
  const set = (t: SiteTheme, from?: { x: number; y: number }) => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!from || still || !document.startViewTransition) return apply(t);
    // The new mode spreads out in a circle from the switch that was pressed.
    const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
    document.startViewTransition(() => apply(t)).ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${r}px at ${from.x}px ${from.y}px)`] },
        { duration: 750, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };
  return [theme, set];
}

/** A pressable switch between light and dark mode: the sun sets into a moon. */
export function ThemeToggle() {
  const [theme, setTheme] = useSiteTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="s-neu-btn"
      aria-pressed={dark}
      aria-label={dark ? "Dark mode on. Switch to light" : "Light mode on. Switch to dark"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTheme(dark ? "light" : "dark", { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      data-testid="theme-toggle"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden className="transition-transform duration-500 ease-[var(--s-ease-out)]" style={{ transform: dark ? "rotate(-40deg)" : "rotate(0deg)" }}>
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
