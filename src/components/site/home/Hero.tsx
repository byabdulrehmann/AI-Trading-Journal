"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { MarketChart } from "../MarketChart";
import { Arrow, Magnetic, SAMPLE_NOTE, SCREENS } from "../parts";
import { useReducedMotion, useScroller } from "../scroll";
import { useSound } from "../sound";
import { ENTERED_EVENT, hasEntered, useEntered } from "../EnterGate";

const LINES = ["Meet your", "trading intelligence."];

// What Jarvis is made of, floating around the display at their own depths.
const CHIPS = [
  { label: "Trading journal", icon: "M5 4h11l3 3v13H5zM9 10h7M9 14h7", at: "top-[14%] -left-[7%]", depth: 26, delay: "0s" },
  { label: "MT5, read-only", icon: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z", at: "top-[4%] -right-[6%]", depth: 40, delay: "-2s" },
  { label: "Analytics", icon: "M4 19V5M4 19h16M8 15l3-4 3 2 5-6", at: "bottom-[22%] -right-[8%]", depth: 18, delay: "-4s" },
  { label: "Psychology", icon: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM8.5 10h.01M15.5 10h.01M8.5 15c2 1.5 5 1.5 7 0", at: "bottom-[10%] -left-[5%]", depth: 34, delay: "-1s" },
];

/**
 * Act 01, a product launch. The headline arrives, then the dashboard rises out of the dark tilted back like a display
 * lying on a desk; scrolling stands it upright and brings it to the centre while the words step aside. On phones and
 * under reduced motion it is a still composition: the headline, then the screen.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  // The hero's chart waits behind the gate as a still frame, so only the gate's chart streams while the page loads.
  const entered = useEntered();
  const { scrollTo } = useScroller();
  const { play } = useSound();

  useGSAP(
    () => {
      if (reduced) return;
      // The entrance waits behind the gate and plays as the gate lifts.
      const intro = gsap
        .timeline({ defaults: { ease: "expo.out" }, paused: !hasEntered() })
        .from(".hero-eyebrow", { opacity: 0, y: 14, duration: 1.1 }, 0.1)
        .from(".hero-line", { yPercent: 110, duration: 1.4, stagger: 0.1 }, 0.18)
        .from(".hero-after", { opacity: 0, y: 18, duration: 1.1, stagger: 0.08 }, 0.6)
        .from(".hero-device", { opacity: 0, yPercent: 16, duration: 1.8 }, 0.45)
        .from(".hero-chip", { opacity: 0, scale: 0.6, duration: 1.2, stagger: 0.12, ease: "back.out(1.6)" }, 1.1);
      const start = () => intro.play();
      window.addEventListener(ENTERED_EVENT, start, { once: true });
      const mm = gsap.matchMedia();
      mm.add("(min-width: 768px)", () => {
        const device = root.current!.querySelector<HTMLElement>(".hero-device")!;
        // From where the screen rests below the fold to the middle of the stage.
        const lift = () => Math.max(76, (innerHeight - device.offsetHeight) / 2) - device.offsetTop;
        gsap
          .timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.7,
              invalidateOnRefresh: true,
              onUpdate: (st) => st.direction === 1 && st.progress > 0.6 && play("reveal"),
            },
          })
          .to(".hero-copy", { yPercent: -40, opacity: 0, duration: 0.45 }, 0)
          .to(".hero-chart", { yPercent: -18, opacity: 0.12, duration: 0.85 }, 0)
          .to(device, { y: lift, duration: 0.85 }, 0)
          .fromTo(".hero-tilt", { rotateX: 24, scale: 0.88 }, { rotateX: 0, scale: 1, duration: 0.85 }, 0)
          .to(".hero-chip-l", { xPercent: -40, ease: "none", duration: 0.85 }, 0)
          .to(".hero-chip-r", { xPercent: 40, ease: "none", duration: 0.85 }, 0)
          .to(".hero-caption", { opacity: 1, duration: 0.1 }, 0.85);
      });
      return () => {
        window.removeEventListener(ENTERED_EVENT, start);
        mm.revert();
      };
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  // The display turns a few degrees toward a mouse, and the light on its glass follows it.
  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const s = e.currentTarget.style;
    s.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3));
    s.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
  };
  const onScreen = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <section id="enter" data-sc-act="enter" data-tone="dark" ref={root} onPointerMove={onMove} className="relative overflow-clip motion-safe:md:h-[230svh]" aria-labelledby="hero-title">
      <div className="relative flex flex-col motion-safe:md:sticky motion-safe:md:top-0 motion-safe:md:h-[100svh] motion-safe:md:overflow-hidden">
        {/* The studio: one light from above, and two slow pools of warm and white light drifting behind. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="s-aurora top-[-18%] left-[8%] h-[60vh] w-[50vw] bg-[color-mix(in_oklab,var(--s-accent-strong)_22%,transparent)]" />
          <div className="s-aurora top-[10%] right-[0%] h-[55vh] w-[44vw] bg-[var(--s-studio)]" />
          <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_-8%,var(--s-studio),transparent_70%)]" />
          {/* A live candlestick chart streams behind the headline; a mouse over it gets a crosshair. */}
          <MarketChart className="hero-chart absolute inset-x-0 top-[10%] h-[62%] w-full opacity-45 [mask-image:radial-gradient(70%_65%_at_50%_45%,#000_25%,transparent_80%)]" candles={80} seed={3} active={entered} />
        </div>

        <div className="hero-copy s-wrap relative z-10 flex flex-col items-center pt-[clamp(124px,18vh,184px)] text-center">
          <p className="hero-eyebrow s-eyebrow">Jarvis</p>
          <h1 id="hero-title" className="s-display s-h1 mt-4 max-w-[13ch]">
            {LINES.map((l) => (
              <span key={l} className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
                <span className={`hero-line block${l === LINES[1] ? " s-shine" : ""}`}>{l}</span>
              </span>
            ))}
          </h1>
          <p className="hero-after s-lede mx-auto mt-7 max-w-[34ch]">Your trading activity, performance and insights, brought together in one intelligent platform.</p>
          <div className="hero-after mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
            <Magnetic>
              <button type="button" className="s-btn s-btn-primary" onClick={() => scrollTo("problem")}>Explore Jarvis</button>
            </Magnetic>
            <Link href="/platform" className="s-more">Discover the platform <Arrow /></Link>
          </div>
        </div>

        <div className="hero-device relative mx-auto mt-16 w-[min(1180px,90vw)] pb-20 [perspective:2000px] motion-safe:md:absolute motion-safe:md:inset-x-0 motion-safe:md:top-[64svh] motion-safe:md:mt-0 motion-safe:md:pb-0">
          <div className="transition-transform duration-700 ease-[var(--s-ease-out)]" style={{ transform: "rotateY(calc(var(--px, 0) * 4deg)) rotateX(calc(var(--py, 0) * -2.5deg))" }}>
            <div className="hero-tilt origin-[50%_100%] will-change-transform motion-safe:md:[transform:rotateX(24deg)_scale(0.88)]">
              <div className="s-frame" onPointerMove={onScreen}>
                <Image src={SCREENS.dashboard.src} width={SCREENS.dashboard.w} height={SCREENS.dashboard.h} alt={SCREENS.dashboard.alt} priority unoptimized draggable={false} sizes="(min-width: 768px) 90vw, 100vw" className="pointer-events-none select-none" />
              </div>
            </div>
          </div>
          {CHIPS.map((c) => (
            <div key={c.label} aria-hidden className={`hero-chip ${c.at.includes("left") ? "hero-chip-l" : "hero-chip-r"} pointer-events-none absolute z-10 hidden md:block ${c.at}`}>
              <div className="transition-transform duration-700 ease-[var(--s-ease-out)]" style={{ transform: `translate(calc(var(--px, 0) * ${c.depth}px), calc(var(--py, 0) * ${c.depth * 0.6}px))` }}>
                <div className="s-neu s-float flex items-center gap-2.5 rounded-full py-2.5 pr-5 pl-3 text-[14px] font-medium whitespace-nowrap text-[var(--s-ink)]" style={{ animationDelay: c.delay }}>
                  <span className="s-neu-in grid size-8 place-items-center rounded-full text-[var(--s-accent-strong)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon} /></svg>
                  </span>
                  {c.label}
                </div>
              </div>
            </div>
          ))}
          {/* The floor the display stands on. */}
          <div aria-hidden className="mx-auto -mt-[1%] h-14 w-[78%] rounded-[50%] bg-[var(--s-neu-lo)] opacity-70 blur-2xl" />
          <p className="hero-caption s-caption text-center motion-safe:md:opacity-0">{SAMPLE_NOTE}</p>
        </div>
      </div>
    </section>
  );
}
