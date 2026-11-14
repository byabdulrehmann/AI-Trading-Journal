"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useReducedMotion } from "./scroll";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * The page-wide motion layer, rendered inside each page so it runs after that page has hydrated:
 * - headings marked data-reveal="words" flip up letter by letter, hinged at the baseline, as they scroll in;
 * - sections marked data-curtain open out of a rounded window as they arrive;
 * - raised cards (.s-card) lean toward a mouse and a soft light follows it.
 * The words are in the HTML already, so without scripts or with reduced motion everything simply shows.
 */
export function WordReveals() {
  const path = usePathname();
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      for (const el of document.querySelectorAll<HTMLElement>("[data-reveal=words]")) {
        const split = SplitText.create(el, { type: "words,chars", mask: "words" });
        gsap.from(split.chars, {
          yPercent: 115,
          rotateX: -85,
          transformOrigin: "50% 100%",
          transformPerspective: 700,
          opacity: 0,
          duration: 1.1,
          ease: "expo.out",
          stagger: 0.016,
          scrollTrigger: { trigger: el, start: "top 86%", once: true },
        });
      }
      for (const el of document.querySelectorAll<HTMLElement>("[data-curtain]")) {
        gsap.fromTo(el, { clipPath: "inset(6% 4% 0% 4% round 56px)" }, { clipPath: "inset(0% 0% 0% 0% round 0px)", ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 20%", scrub: true } });
      }
    },
    { dependencies: [path, reduced], revertOnUpdate: true },
  );

  useEffect(() => {
    if (reduced || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let card: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const next = e.target instanceof Element ? e.target.closest<HTMLElement>(".s-card") : null;
      if (card && card !== next) card.style.transform = "";
      card = next;
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(1000px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg) translateY(-3px)`;
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      if (card) card.style.transform = "";
    };
  }, [reduced, path]);
  return null;
}
