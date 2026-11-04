"use client";

import { useApp } from "@/lib/client/app-state";
import { cx } from "./ui";

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(440px,calc(100%-24px))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "animate-rise pointer-events-auto flex items-center gap-3 rounded-lg border bg-raised px-4 py-3 text-[14px] shadow-lg",
            t.tone === "error" ? "border-loss/60" : t.tone === "success" ? "border-profit/50" : "border-line-strong",
          )}
        >
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="text-muted hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
