"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type { SceneProgress } from "../CandleScene";
import { Arrow, Magnetic, SCREENS } from "../parts";
import { SceneMount } from "../SceneMount";
import { useReducedMotion, useScroller } from "../scroll";

/** Out-of-focus candles in the near plane: they cross the headline's edges, never its words. */
function NearCandle({ className, up, h }: { className: string; up: boolean; h: number }) {
  return (
    <div className={`pointer-events-none absolute ${className}`} aria-hidden>
      <div className="relative mx-auto w-[3px] rounded-full bg-[var(--s-metal)]" style={{ height: h * 1.7 }} />
      <div className="absolute top-1/2 left-1/2 w-[42px] -translate-x-1/2 -translate-y-1/2 rounded-[6px]" style={{ height: h, background: up ? "linear-gradient(180deg,var(--s-metal),color-mix(in oklab,var(--s-metal) 45%,var(--s-canvas)))" : "linear-gradient(180deg,var(--s-loss),color-mix(in oklab,var(--s-loss) 45%,var(--s-canvas)))" }} />
    </div>
  );
}

export function Hero() {
  const root = useRef<HTMLElement>(null);
  // A plain mutable box the WebGL frame loop reads; scroll writes it without re-rendering.
  const [progress] = useState<SceneProgress>(() => ({ current: 0 }));
  const reduced = useReducedMotion();
  const { scrollTo } = useScroller();

  useGSAP(
    () => {
      if (reduced) return;
      // The headline arrives line by line on load.
      gsap.from(".hero-line", { yPercent: 60, opacity: 0, filter: "blur(10px)", duration: 1.2, ease: "expo.out", stagger: 0.1, delay: 0.15, clearProps: "filter" });
      gsap.from(".hero-light", { opacity: 0, duration: 2.4, ease: "power2.out" });
      // The product sliver drifts, as if it floats in the near plane.
      gsap.to(".hero-float", { y: -12, rotateZ: -0.6, duration: 3.6, ease: "sine.inOut", repeat: -1, yoyo: true });
      gsap.from(".hero-after", { y: 20, opacity: 0, duration: 0.9, ease: "expo.out", delay: 0.55, stagger: 0.08 });
      const tl = gsap.timeline({
        scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.6, onUpdate: (st) => (progress.current = st.progress) },
      });
      // Planes at different rates: copy slowest, near candles faster, the dashboard sliver fastest.
      tl.to(".hero-copy", { yPercent: -18, opacity: 0, ease: "none", duration: 0.5 }, 0.32)
        .to(".hero-near-a", { y: "-38vh", ease: "none", duration: 1 }, 0)
        .to(".hero-near-b", { y: "-62vh", ease: "none", duration: 1 }, 0)
        .to(".hero-sliver", { y: "-80vh", rotateY: -6, ease: "none", duration: 1 }, 0)
        .to(".hero-shade", { opacity: 0.75, ease: "none", duration: 0.3 }, 0.7);
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  // Pointer depth: each plane shifts by its own amount, nearer planes more, and a soft light follows the pointer.
  const onMove = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !root.current) return;
    const s = root.current.style;
    s.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
    s.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
    s.setProperty("--hx", `${e.clientX}px`);
    s.setProperty("--hy", `${e.clientY}px`);
  };

  return (
    <section id="enter" onPointerMove={onMove} data-sc-act="enter" ref={root} className="relative h-[170svh] motion-reduce:h-auto" aria-labelledby="hero-title">
      <div className="sticky top-0 h-[100svh] overflow-hidden motion-reduce:relative">
        <SceneMount mode="field" progress={progress} poster="/site/poster-field.webp" />
        {/* Atmosphere: a low violet rim from the left, the floor fading to ground. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,transparent_58%,var(--s-canvas)_100%)]" />

        <div aria-hidden className="hero-light pointer-events-none absolute inset-0 hidden bg-[radial-gradient(560px_circle_at_var(--hx,70%)_var(--hy,40%),var(--s-sheen),transparent_65%)] opacity-50 lg:block" />
        <div className="hero-near-a hero-depth pointer-events-none absolute inset-0 hidden md:block [--depth:22px]" aria-hidden>
          <NearCandle className="top-[18%] right-[30%] blur-[6px] opacity-60" up h={120} />
          <NearCandle className="top-[58%] right-[8%] blur-[10px] opacity-50" up={false} h={170} />
        </div>
        <div className="hero-near-b hero-depth pointer-events-none absolute inset-0 hidden md:block [--depth:40px]" aria-hidden>
          <NearCandle className="top-[72%] left-[47%] blur-[14px] opacity-45" up h={220} />
        </div>
        {/* A sliver of the real product in the nearest plane, angled away. */}
        <div className="hero-sliver pointer-events-none absolute top-[62%] -right-[14vw] hidden w-[46vw] [transform:perspective(1400px)_rotateY(-22deg)_rotateX(6deg)] lg:block" aria-hidden>
          <div className="hero-depth [--depth:56px]">
            <div className="hero-float s-frame opacity-80">
              <Image src={SCREENS.kpis.src} width={SCREENS.kpis.w} height={SCREENS.kpis.h} alt="" unoptimized priority />
            </div>
          </div>
        </div>

        <div className="hero-copy s-wrap relative z-10 flex h-full flex-col justify-end pt-[96px] pb-[11vh]">
          <h1 id="hero-title" className="s-display s-h1">
            <span className="block overflow-hidden pb-[0.2em] -mb-[0.14em]"><span className="hero-line block">Your trades.</span></span>
            <span className="block overflow-hidden pb-[0.2em] -mb-[0.14em]"><span className="hero-line block">Your intelligence.</span></span>
            <span className="block overflow-hidden pb-[0.2em] -mb-[0.14em]"><span className="hero-line block text-[var(--s-accent)]">Your edge.</span></span>
          </h1>
          <p className="hero-after s-lede mt-6">A smarter way to understand your trading performance, monitor your accounts and build a more disciplined trading process.</p>
          <div className="hero-after mt-8 flex flex-wrap items-center gap-3">
            <Magnetic>
              <button type="button" className="s-btn s-btn-primary" onClick={() => scrollTo("problem")}>
                Explore Jarvis <Arrow />
              </button>
            </Magnetic>
            <Link href="/platform" className="s-btn s-btn-ghost">Discover the platform</Link>
          </div>
        </div>
        <div className="hero-shade pointer-events-none absolute inset-0 bg-[var(--s-canvas)] opacity-0" aria-hidden />
      </div>
    </section>
  );
}
