"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx } from "./ui";

/** A button that opens a panel under it. Closes on Escape, on a click outside, or when the panel asks. */
export function Dropdown({
  label,
  button,
  children,
  align = "right",
  className,
  panelClassName,
  title,
}: {
  label: string;
  button: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={label} title={title ?? label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className={className}>
        {button}
      </button>
      {open && (
        <div id={id} role="dialog" aria-label={label} className={cx("absolute top-full z-[var(--z-sticky)] mt-1.5 rounded-panel border border-line bg-surface p-3 shadow-xl", align === "right" ? "right-0" : "left-0", panelClassName)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="shrink-0 text-ink-soft">
      <path d="M1.5 3.5L5 7l3.5-3.5" fill="currentColor" />
    </svg>
  );
}

/** 16 px line icons, drawn from one path each. */
export function Icon({ d, size = 16, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx("shrink-0", className)}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  dashboard: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  journal: "M5 4h14v16H5zM9 4v16M12 9h4M12 13h4",
  trades: "M5 20V10M10 20V4M15 20v-7M20 20V8",
  notebook: "M6 3h12v18H6zM10 3v18M13 8h3M13 12h3",
  progress: "M4 20h16M7 16v-4M12 16V8M17 16v-7",
  playbook: "M6 3h12v18l-6-4-6 4z",
  reports: "M4 4h16v16H4zM8 15v-3M12 15V9M16 15v-5",
  backtest: "M4 4v16h16M8 15l3-4 3 2 5-6",
  replay: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5l5 3.5-5 3.5z",
  mentor: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-5M21 20c0-2.6-1.6-4.8-4-5.6",
  university: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5",
  resources: "M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  patterns: "M4 16l5-5 4 4 7-8",
  market: "M3 12h4l3-7 4 14 3-7h4",
  news: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M13 12l-3 4h4l-3 4",
  coach: "M4 5h16v11H9l-5 4zM9 10.5h.01M15 10.5h.01",
  accounts: "M3 7h18v12H3zM3 11h18M7 15h3",
  settings: "M5 7h14M5 12h14M5 17h14M9 5v4M15 10v4M8 15v4",
  plus: "M12 5v14M5 12h14",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  date: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  wallet: "M3 7h15a3 3 0 0 1 3 3v8H3zM3 7l12-3v3M16 13h2",
  rocket: "M12 15l-3-3c1.5-4 4.5-7 9-8-1 4.5-4 7.5-8 9zM9 12l-4 1 2-4 4-1M12 15l-1 4 4-2 1-4M6 18l-2 2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1-1-3H10L9 7 7 8 5 7l-2 4 2 1v0l-2 1 2 4 2-1 2 1 1 3h4l1-3 2-1 2 1 2-4z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  open: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  menu: "M3 6h18M3 12h18M3 18h18",
};
