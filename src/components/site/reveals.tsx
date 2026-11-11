"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "./scroll";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * Headings marked data-reveal="words" rise word by word from behind a mask as they scroll in. The words are in the
 * HTML already, so without scripts or with reduced motion they simply show.
 */
export function WordReveals() {
  const path = usePathname();
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      if (reduced) return;
      for (const el of document.querySelectorAll<HTMLElement>("[data-reveal=words]")) {
        const split = SplitText.create(el, { type: "words", mask: "words" });
        gsap.from(split.words, { yPercent: 110, duration: 0.9, ease: "expo.out", stagger: 0.045, scrollTrigger: { trigger: el, start: "top 86%", once: true } });
      }
    },
    { dependencies: [path, reduced], revertOnUpdate: true },
  );
  return null;
}
