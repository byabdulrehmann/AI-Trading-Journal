"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";

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
    const l = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3), anchors: { offset: -72 }, autoRaf: false });
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
    if (lenis.current) lenis.current.scrollTo(el ?? (typeof target === "number" ? target : 0), { offset: el ? -72 : 0 });
    else if (el) el.scrollIntoView({ block: "start" });
    else if (typeof target === "number") window.scrollTo(0, target);
  }, []);
  const value = useMemo(() => ({ scrollTo }), [scrollTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
