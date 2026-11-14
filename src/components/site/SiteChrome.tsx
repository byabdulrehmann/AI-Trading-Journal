"use client";

import { usePathname } from "next/navigation";
import { Cursor } from "./Cursor";
import { EnterGate } from "./EnterGate";
import { SiteFooter } from "./parts";
import { SiteNav } from "./SiteNav";
import { SmoothScroll } from "./scroll";
import { SoundProvider } from "./sound";

export const HOME_CHAPTERS = [
  { id: "enter", label: "Enter Jarvis" },
  { id: "chart", label: "Every candle" },
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
      <EnterGate />
      <SmoothScroll>
        <SiteNav chapters={home ? HOME_CHAPTERS : undefined} />
        <main id="site-main" tabIndex={-1} className="outline-none">{children}</main>
        <SiteFooter />
        <Cursor />
      </SmoothScroll>
    </SoundProvider>
  );
}
