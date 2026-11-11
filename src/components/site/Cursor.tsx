"use client";

import gsap from "gsap";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useReducedMotion } from "./scroll";

const finePointer = "(hover: hover) and (pointer: fine)";
const subscribe = (cb: () => void) => {
  const mq = matchMedia(finePointer);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useFinePointer = () => useSyncExternalStore(subscribe, () => matchMedia(finePointer).matches, () => false);

const CLICKABLE = "a[href], button:not(:disabled), [role=button], summary, label[for], select, [data-cursor]";
const CTA = ".s-btn-primary, [data-cursor=cta]";
const TEXT = "input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea";

/**
 * A dot that follows a mouse, with a ring trailing it. It grows over anything clickable and leans toward the main
 * calls to action. The system cursor stays: this only accompanies it, never takes clicks, and is absent on touch
 * screens and under reduced motion.
 */
export function Cursor() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  return fine && !reduced ? <Follower /> : null;
}

function Follower() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current!;
    const dot = el.querySelector<HTMLElement>(".s-cursor-dot")!;
    const ring = el.querySelector<HTMLElement>(".s-cursor-ring")!;
    gsap.set([dot, ring], { xPercent: -50, yPercent: -50 });
    const dx = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power3.out" });
    const dy = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power3.out" });
    const rx = gsap.quickTo(ring, "x", { duration: 0.42, ease: "power3.out" });
    const ry = gsap.quickTo(ring, "y", { duration: 0.42, ease: "power3.out" });
    let cta: Element | null = null;

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      el.dataset.visible = "true";
      dx(e.clientX);
      dy(e.clientY);
      // Over a main action the ring is drawn toward its centre, so the button feels like it pulls.
      if (cta) {
        const r = cta.getBoundingClientRect();
        rx(e.clientX + (r.left + r.width / 2 - e.clientX) * 0.6);
        ry(e.clientY + (r.top + r.height / 2 - e.clientY) * 0.6);
      } else {
        rx(e.clientX);
        ry(e.clientY);
      }
    };
    const over = (e: PointerEvent) => {
      if (!(e.target instanceof Element)) return;
      cta = e.target.closest(CTA);
      el.dataset.state = e.target.closest(TEXT) ? "text" : cta ? "cta" : e.target.closest(CLICKABLE) ? "link" : "";
    };
    const down = () => (el.dataset.down = "true");
    const up = () => delete el.dataset.down;
    const leave = () => delete el.dataset.visible;

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("pointerleave", leave);
      gsap.killTweensOf([dot, ring]);
    };
  }, []);
  return (
    <div ref={root} className="s-cursor" aria-hidden data-testid="site-cursor">
      <div className="s-cursor-ring"><span /></div>
      <div className="s-cursor-dot"><span /></div>
    </div>
  );
}
