"use client";

import { useEffect } from "react";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Everything on the page is complete without this file. Script only subtracts and replays:
 * no JS or reduced motion means a finished sum, a stacked rail and a still hero.
 */
export function WelcomeMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".jw");
    if (!root) return;
    const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s);
    const $$ = <T extends Element = HTMLElement>(s: string) => [...root.querySelectorAll<T>(s)];

    // The margin index: ticks stay ticked, in every motion mode.
    const index = $(".jw-index");
    const links = $$<HTMLAnchorElement>(".jw-index a");
    const sections = links.map((a) => document.querySelector(a.getAttribute("href") ?? ""));
    const updateIndex = () => {
      const first = sections[0];
      index?.classList.toggle("is-on", !!first && first.getBoundingClientRect().top < innerHeight * 0.3);
      let current = -1;
      sections.forEach((s, i) => {
        if (s && s.getBoundingClientRect().top < innerHeight * 0.5) current = i;
      });
      links.forEach((a, i) => {
        a.classList.toggle("is-passed", i <= current);
        if (i === current) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    };

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      updateIndex();
      addEventListener("scroll", updateIndex, { passive: true });
      return () => removeEventListener("scroll", updateIndex);
    }

    const coarse = matchMedia("(pointer: coarse)").matches;
    const wide = matchMedia("(min-width: 761px)");

    const plane = (n: string) => $(`[data-plane="${n}"]`);
    const planes = { far: plane("far"), copy: plane("copy"), under: plane("under"), sheet: plane("sheet"), rows: plane("rows"), pencil: plane("pencil"), rule: plane("rule"), air: plane("air"), note: plane("note") };
    const hero = $(".jw-hero");
    const sum = $("[data-sum]");
    const strokes = $$<SVGPathElement>("[data-sum] .jw-working [data-stroke]");
    const tick = $<SVGPathElement>("[data-sum] .jw-tick--big path");
    const source = $("[data-source]");
    const print = $("[data-print]");
    const verdict = $("[data-verdict]");
    const pan = $("[data-pan]");
    const track = $("[data-track]");
    const close = $("[data-close]");
    const doubles = $$("[data-double]");
    const lines = $$("[data-line]");
    const wipes = $$("[data-wipe]");

    const done = new Array<number>(strokes.length).fill(-1);
    let vh = innerHeight;
    let box = { hero: { top: 0, h: 1 }, sum: { top: 0, h: 1 }, pan: { top: 0, h: 1 }, close: { top: 0, h: 1 } };
    let lineTops: number[] = [];
    let panTravel = 0;
    let land = { dx: 0, dy: 0, s: 1 };
    let mx = 0;
    let my = 0;
    let y = -1;
    let smooth = scrollY;
    let raf = 0;

    const measure = () => {
      vh = innerHeight;
      const y0 = scrollY;
      const of = (el: Element | null) => {
        const r = el?.getBoundingClientRect();
        return { top: (r?.top ?? 0) + y0, h: r?.height ?? 1 };
      };
      box = { hero: of(hero), sum: of(sum), pan: of(pan), close: of(close) };
      lineTops = lines.map((l) => of(l).top);
      if (track) panTravel = wide.matches ? Math.max(0, track.scrollWidth - (track.parentElement?.clientWidth ?? 0) + track.offsetLeft + 40) : 0;
      if (print && source) {
        print.style.transform = "none";
        const a = source.getBoundingClientRect();
        const b = print.getBoundingClientRect();
        land = { dx: a.right - b.right, dy: a.top + a.height / 2 - (b.top + b.height / 2), s: a.height / b.height || 1 };
      }
      y = -1;
    };

    // Opening pose of the book. Phones get their own: flatter, lower, under the type.
    const pose = () => (wide.matches ? { x: 30, y: 7, rx: 50, rz: -21, s: 0.66 } : { x: 11, y: 37, rx: 46, rz: -15, s: 0.86 });

    const progress = (b: { top: number; h: number }) => {
      const travel = b.h - vh;
      // Not pinned (a short screen): play across the section's time on screen instead.
      if (travel < 50) return span(y, b.top - vh * 0.7, b.top + Math.max(0, b.h - vh * 0.6));
      return clamp((y - b.top) / travel);
    };

    const render = () => {
      if (y <= box.hero.top + box.hero.h) {
        const p = progress(box.hero);
        const e = inOut(span(p, 0, 0.94));
        const o = pose();
        const k = 1 - e;
        const px = mx * k;
        const py = my * k;
        if (planes.sheet) planes.sheet.style.transform = e >= 1 ? "none" : `translate3d(${o.x * k + px * 0.7}vw,${o.y * k + py * 0.5}vh,0) rotateX(${o.rx * k}deg) rotateZ(${o.rz * k}deg) scale(${mix(o.s, 1, e)})`;
        if (planes.under) planes.under.style.transform = `translate3d(${(o.x + 2) * k + px * 0.4}vw,${(o.y + 5) * k + py * 0.3}vh,0) rotateX(${o.rx * k}deg) rotateZ(${(o.rz - 5) * k}deg) scale(${mix(o.s, 1, e)})`;
        if (planes.far) planes.far.style.transform = `translate3d(${px * -0.15}vw,${-p * 5 + py * -0.1}vh,0) scale(1.08)`;
        if (planes.pencil) planes.pencil.style.transform = `translate3d(${e * 62 + px * 1.1}vw,${e * 28 + py * 0.9}vh,0) rotate(${-34 + e * 16}deg)`;
        if (planes.rule) planes.rule.style.transform = `translate3d(${e * 30 + px * 2}vw,${e * 40 + py * 1.6}vh,0) rotate(-9deg)`;
        if (planes.air) planes.air.style.opacity = `${1 - span(p, 0.2, 0.8)}`;
        if (planes.note) planes.note.style.opacity = `${1 - span(p, 0, 0.15)}`;
        if (planes.rows) planes.rows.style.opacity = `${1 - span(p, 0.7, 0.94)}`;
        if (planes.copy) {
          planes.copy.style.transform = `translate3d(0,${-p * 7}vh,0)`;
          planes.copy.style.visibility = e > 0.9 ? "hidden" : "visible";
        }
      }

      lines.forEach((l, i) => {
        l.style.opacity = `${mix(0.16, 1, span(y + vh, lineTops[i] + vh * 0.12, lineTops[i] + vh * 0.5))}`;
      });

      if (y + vh > box.sum.top && y < box.sum.top + box.sum.h) {
        const p = progress(box.sum);
        const q = span(p, 0.05, 0.64) * strokes.length;
        strokes.forEach((s, i) => {
          const d = clamp(q - i);
          if (d === done[i]) return;
          done[i] = d;
          s.style.strokeDashoffset = `${1 - d}`;
          s.style.opacity = d > 0 ? "" : "0";
        });
        const fall = inOut(span(p, 0.66, 0.8));
        if (print) {
          print.style.opacity = p > 0.66 ? "1" : "0";
          print.style.transform = `translate3d(${land.dx * (1 - fall)}px,${land.dy * (1 - fall)}px,0) scale(${mix(land.s, 1, fall)})`;
        }
        root.style.setProperty("--jw-pencil-dim", fall >= 1 ? "0.5" : "1");
        if (tick) {
          const t = span(p, 0.8, 0.87);
          tick.style.strokeDashoffset = `${1 - t}`;
          tick.style.opacity = t > 0 ? "1" : "0";
        }
        if (verdict) verdict.style.opacity = `${span(p, 0.84, 0.92)}`;
      }

      if (track && panTravel && y + vh > box.pan.top && y < box.pan.top + box.pan.h) {
        track.style.transform = `translate3d(${-span(progress(box.pan), 0.04, 0.96) * panTravel}px,0,0)`;
      }

      if (y + vh > box.close.top) {
        const p = ease(span(y + vh, box.close.top + box.close.h * 0.35, box.close.top + box.close.h * 0.95));
        doubles.forEach((d, i) => {
          d.style.transform = `scaleX(${span(p, i * 0.25, 0.75 + i * 0.25)})`;
        });
      }
    };

    const frame = () => {
      raf = 0;
      const target = scrollY;
      smooth = coarse || Math.abs(target - smooth) < 0.5 ? target : smooth + (target - smooth) * 0.16;
      if (smooth !== y) {
        y = smooth;
        render();
      }
      updateIndex();
      if (smooth !== target) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    // Below-the-fold rows wipe in once. Anything already on screen just stays.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const w of wipes)
      if (w.getBoundingClientRect().top > innerHeight * 0.9) {
        w.classList.add("is-armed");
        io.observe(w);
      }

    const onPointer = (e: PointerEvent) => {
      mx = (e.clientX / innerWidth - 0.5) * 1.1;
      my = (e.clientY / innerHeight - 0.5) * 1.1;
      y = -1;
      kick();
    };
    if (!coarse) addEventListener("pointermove", onPointer, { passive: true });

    const onResize = () => {
      measure();
      kick();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(root);
    addEventListener("scroll", kick, { passive: true });

    measure();
    updateIndex();
    kick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("scroll", kick);
      removeEventListener("pointermove", onPointer);
    };
  }, []);
  return null;
}
