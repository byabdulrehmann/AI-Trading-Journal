// Every section of the website has its own path, /home/mt5 or /about/risk. The proxy serves it with the page's own
// HTML (a rewrite to /home), and the page scrolls to the section. Plain module: the proxy and client code both read it.

/** The sections of each site page, in page order. A section missing here has no path of its own (it 404s). */
export const SITE_SECTIONS: Record<string, readonly string[]> = {
  home: ["enter", "instruments", "chart", "problem", "introducing", "journal", "mt5", "analytics", "psychology", "next", "reveal"],
  platform: ["day", "mt5", "private", "technology", "get-started"],
  features: ["getting-trades-in", "the-trading-journal", "analytics", "discipline-and-progress", "practice-and-intelligence", "coming-to-jarvis", "get-started"],
  about: ["principles", "never", "risk", "get-started"],
  contact: ["early-access"],
};

/** The section a path names, or null: "/home/mt5" → { page: "/home", section: "mt5" }. */
export function sectionPath(pathname: string): { page: string; section: string } | null {
  const [, page, section, ...rest] = pathname.split("/");
  return section && !rest.length && SITE_SECTIONS[page]?.includes(section) ? { page: `/${page}`, section } : null;
}

/** Under a site page (/home, /home/anything): public, so a mistyped section is "not found", not a sign-in screen. */
export const isSitePath = (pathname: string) => Object.hasOwn(SITE_SECTIONS, pathname.split("/")[1]);

/** The page a path belongs to: "/home/mt5" → "/home"; any other path comes back unchanged. */
export const pagePath = (pathname: string) => sectionPath(pathname)?.page ?? pathname;
