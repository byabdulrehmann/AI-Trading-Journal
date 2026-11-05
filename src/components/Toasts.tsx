"use client";

import { useApp } from "@/lib/client/app-state";
import { cx } from "./ui";

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[var(--z-toast)] flex w-[min(440px,calc(100%-24px))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "animate-rise pointer-events-auto flex items-center gap-3 border border-l-2 border-line-strong bg-raised px-3 py-2 text-[14px]",
            t.tone === "error" ? "border-l-loss" : t.tone === "success" ? "border-l-profit" : "border-l-line-strong",
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-8 font-medium text-ink underline underline-offset-2 pointer-coarse:min-h-11"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="grid h-8 w-8 shrink-0 place-items-center text-muted hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>
          </button>
        </div>
      ))}
    </div>
  );
}
