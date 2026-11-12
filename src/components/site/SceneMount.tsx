"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";
import type { SceneProgress } from "./CandleScene";
import { useSiteTheme } from "./theme";
import { useReducedMotion } from "./scroll";

// three.js loads only when a scene is about to be seen, never on the other pages.
const CandleScene = dynamic(() => import("./CandleScene"), { ssr: false });

let webgl: boolean | null = null;
function hasWebGL() {
  if (webgl === null) {
    try {
      const c = document.createElement("canvas");
      webgl = Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const noop = () => () => {};
const subscribeWidth = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/**
 * Mounts the WebGL scene when its section nears the viewport, pauses it when it leaves, and shows a poster when the
 * browser can't run WebGL. The poster is a render of the same scene, so the page reads the same either way.
 */
export function SceneMount({ mode, progress, className, poster }: { mode: "field" | "mark"; progress: SceneProgress; className?: string; poster: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const still = useReducedMotion();
  const [theme] = useSiteTheme();
  const gl = useSyncExternalStore(noop, hasWebGL, () => true);
  const compact = useSyncExternalStore(subscribeWidth, () => window.innerWidth < 768, () => false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mount = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "100% 0px" });
    const run = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "10% 0px" });
    mount.observe(el);
    run.observe(el);
    return () => {
      mount.disconnect();
      run.disconnect();
    };
  }, []);

  return (
    <div ref={box} className={cx("absolute inset-0", className)} aria-hidden>
      {/* The poster sits underneath: it is what shows while the scene loads, and all that shows without WebGL. */}
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${poster.replace(".webp", `-${theme}.webp`)})` }} />
      {gl && near && (
        <div className="absolute inset-0 animate-[site-fade_900ms_var(--s-ease-out)_both]">
          {/* Keyed by theme: the studio lighting is baked once per mount. */}
          <CandleScene key={theme} mode={mode} progress={progress} active={visible} still={still} compact={compact} theme={theme} />
        </div>
      )}
    </div>
  );
}
