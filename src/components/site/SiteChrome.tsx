"use client";

import { usePathname } from "next/navigation";
import { Cursor } from "./Cursor";
import { SiteFooter } from "./parts";
import { SiteNav } from "./SiteNav";
import { WordReveals } from "./reveals";
import { SmoothScroll } from "./scroll";
import { SoundProvider } from "./sound";

export const HOME_CHAPTERS = [
  { id: "enter", label: "Enter Jarvis" },
  { id: "problem", label: "The trader's problem" },
  { id: "introducing", label: "Introducing Jarvis" },
  { id: "journal", label: "The trading journal" },
  { id: "mt5", label: "MT5 monitoring" },
  { id: "analytics", label: "Performance analytics" },
  { id: "psychology", label: "Trading psychology" },
  { id: "next", label: "What comes next" },
  { id: "reveal", label: "Jarvis" },
];

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const home = usePathname() === "/welcome";
  return (
    <SoundProvider>
      <SmoothScroll>
        <SiteNav chapters={home ? HOME_CHAPTERS : undefined} />
        <main id="site-main" tabIndex={-1} className="outline-none">{children}</main>
        <SiteFooter />
        <div className="site-grain" aria-hidden />
        <Cursor />
        <WordReveals />
      </SmoothScroll>
    </SoundProvider>
  );
}
