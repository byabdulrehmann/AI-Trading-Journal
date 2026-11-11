"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { SceneProgress } from "../CandleScene";
import { Arrow, Magnetic } from "../parts";
import { SceneMount } from "../SceneMount";
import { CTA_HREF, CTA_LABEL, Mark } from "../SiteNav";
import { useReducedMotion } from "../scroll";
import { useSound } from "../sound";

/** Act 09: the hero's candles come back and settle on the Jarvis mark's rising line. Then one line and one action. */
export function Reveal() {
  const root = useRef<HTMLElement>(null);
  // A plain mutable box the WebGL frame loop reads; scroll writes it without re-rendering.
  const [progress] = useState<SceneProgress>(() => ({ current: 0 }));
  const reduced = useReducedMotion();
  const { play } = useSound();

  useGSAP(
    () => {
      // Under reduced motion the scene draws the finished mark by itself (see CandleScene's still mode).
      if (reduced) return;
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "bottom bottom",
          scrub: 0.8,
          onUpdate: (st) => {
            progress.current = st.progress;
            if (st.progress > 0.8) play("finale");
          },
        },
      });
      tl.fromTo(".reveal-mark", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.18, ease: "power2.out" }, 0.62)
        .fromTo(".reveal-line", { yPercent: 70, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.16, stagger: 0.05, ease: "power3.out" }, 0.66)
        .fromTo(".reveal-cta", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.12, ease: "power3.out" }, 0.78)
        .to({}, { duration: 0.12 });
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <section id="reveal" data-sc-act="reveal" ref={root} className="relative h-[170svh] motion-reduce:h-auto" aria-labelledby="reveal-title">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden motion-reduce:relative motion-reduce:h-auto motion-reduce:min-h-[100svh]">
        <SceneMount mode="mark" progress={progress} poster="/site/poster-mark.webp" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_42%,rgb(255_106_74/0.06),transparent_70%),linear-gradient(180deg,var(--s-canvas)_0%,transparent_18%,transparent_60%,rgb(9_12_11/0.92)_100%)]" />
        <div className="s-wrap relative z-10 mt-auto flex flex-col items-center pb-[10vh] text-center">
          <div className="reveal-mark mb-8"><Mark size={56} /></div>
          <h2 id="reveal-title" className="s-display s-h1 max-w-[20ch]">
            <span className="block overflow-hidden pb-[0.2em] -mb-[0.14em]"><span className="reveal-line block">Stop guessing.</span></span>
            <span className="block overflow-hidden pb-[0.2em] -mb-[0.14em]"><span className="reveal-line block text-[var(--s-metal)]">Start understanding your trading.</span></span>
          </h2>
          <div className="reveal-cta mt-10 flex flex-wrap items-center justify-center gap-3">
            <Magnetic strength={0.35}>
              <Link href={CTA_HREF} className="s-btn s-btn-primary h-14! px-8! text-[16px]!">
                {CTA_LABEL} <Arrow />
              </Link>
            </Magnetic>
            <Link href="/login" className="s-btn s-btn-ghost h-14! px-7!">Sign in</Link>
          </div>
          <p className="reveal-cta s-caption mt-6">Early access is by request. Jarvis runs on your own computer.</p>
        </div>
      </div>
    </section>
  );
}
