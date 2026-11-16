"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ENTERED_EVENT, hasEntered } from "./boot-scripts";
import { pagePath, sectionPath } from "@/lib/site-paths";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
/** True when the visitor asked for less motion. Server render assumes full motion and corrects on hydration. */
export const useReducedMotion = () => useSyncExternalStore(subscribeMotion, () => matchMedia(motionQuery).matches, () => false);

interface Scroller {
  /** Scrolls to an element id or a y position, smoothly unless motion is reduced. */
  scrollTo: (target: string | number) => void;
}
const Ctx = createContext<Scroller>({ scrollTo: () => {} });
export const useScroller = () => useContext(Ctx);

/**
 * Lenis smooths wheel scrolling and hands every frame to ScrollTrigger, both on GSAP's ticker so they never drift.
 * Keyboard, scrollbar and browser history keep working: Lenis only interpolates the native scroll position.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const lenis = useRef<Lenis | null>(null);

  useEffect(() => {
    if (reduced) return;
    const l = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3), anchors: true, autoRaf: false });
    lenis.current = l;
    l.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => l.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      l.destroy();
      lenis.current = null;
    };
  }, [reduced]);

  // Fonts and images change heights after first paint; re-measure triggers once everything has landed.
  useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    void document.fonts?.ready.then(refresh);
    return () => window.removeEventListener("load", refresh);
  }, []);

  const scrollTo = useCallback((target: string | number) => {
    const el = typeof target === "string" ? document.getElementById(target) : null;
    if (lenis.current) lenis.current.scrollTo(el ?? (typeof target === "number" ? target : 0));
    else if (el) el.scrollIntoView({ block: "start" });
    else if (typeof target === "number") window.scrollTo(0, target);
  }, []);
  const pathname = usePathname();
  // The path this component last wrote while the visitor scrolled: arriving there is not a request to move.
  const written = useRef<string | null>(null);

  // Every section has its own path (/home/mt5, /about/risk). Opening one lands on that section once the visitor is
  // past the gate and the page has its final heights (pinned sections and late images change them). An older link
  // with a hash (/home#mt5) lands the same way.
  useEffect(() => {
    if (pathname === written.current) return;
    const id = sectionPath(pathname)?.section ?? decodeURIComponent(location.hash.slice(1));
    if (!id || !document.getElementById(id)) return;
    let cancelled = false;
    const land = async () => {
      if (document.readyState !== "complete") await new Promise((r) => window.addEventListener("load", r, { once: true }));
      await document.fonts?.ready;
      if (cancelled) return;
      ScrollTrigger.refresh();
      const el = document.getElementById(id);
      if (!el) return;
      if (lenis.current) lenis.current.scrollTo(el, { immediate: true, force: true });
      else el.scrollIntoView({ block: "start" });
    };
    if (hasEntered()) void land();
    else window.addEventListener(ENTERED_EVENT, () => void land(), { once: true });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // The address bar follows the reading: it names the section under the top third of the screen (/home/mt5), and
  // shows the page alone at the very top. replaceState, so scrolling doesn't fill the back button with entries.
  useEffect(() => {
    let raf = 0;
    const sync = () => {
      raf = 0;
      if (!hasEntered()) return; // the gate is up: keep the link the visitor arrived with
      const line = innerHeight / 3;
      let current: HTMLElement | null = null;
      for (const s of document.querySelectorAll<HTMLElement>("#site-main section[id]")) if (s.getBoundingClientRect().top <= line) current = s;
      const atTop = !current || current.getBoundingClientRect().top + scrollY < 8;
      const page = pagePath(location.pathname);
      const path = atTop ? page : `${page}/${current!.id}`;
      if (path === location.pathname && !location.hash) return;
      written.current = path;
      history.replaceState(null, "", path + location.search);
    };
    const onScroll = () => (raf ||= requestAnimationFrame(sync));
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const value = useMemo(() => ({ scrollTo }), [scrollTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
