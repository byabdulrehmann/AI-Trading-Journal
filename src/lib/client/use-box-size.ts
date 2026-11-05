"use client";

import { useCallback, useState } from "react";

/** The element's content size, so an SVG can draw at real pixels and its labels stay readable on a phone. */
export function useBoxSize<T extends Element>(fallback: { width: number; height: number }) {
  const [size, setSize] = useState(fallback);
  const ref = useCallback((el: T | null) => {
    if (!el) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      setSize((s) => (width > 0 && (s.width !== width || s.height !== height) ? { width, height } : s));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}
