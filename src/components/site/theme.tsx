"use client";

import { useSyncExternalStore } from "react";

export type SiteTheme = "light" | "dark";
const KEY = "jarvis-site-theme";
const EVENT = "jarvis-site-theme";

/**
 * Runs before the first paint (an inline script) so a returning visitor never sees the other theme flash. A stored
 * choice wins; otherwise the system's light or dark preference decides.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.siteTheme=t}catch(e){document.documentElement.dataset.siteTheme="light"}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}

const read = (): SiteTheme => (document.documentElement.dataset.siteTheme === "dark" ? "dark" : "light");
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

export function useSiteTheme(): [SiteTheme, (t: SiteTheme) => void] {
  const theme = useSyncExternalStore<SiteTheme>(subscribe, read, () => "light");
  const set = (t: SiteTheme) => {
    document.documentElement.dataset.siteTheme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      // Private windows can refuse storage; the choice still holds for this page.
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [theme, set];
}

/** A soft, pressable switch between the pearl and obsidian rooms. */
export function ThemeToggle() {
  const [theme, setTheme] = useSiteTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="s-neu-btn"
      aria-pressed={dark}
      aria-label={dark ? "Dark theme on. Switch to light" : "Light theme on. Switch to dark"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      data-testid="theme-toggle"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
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
