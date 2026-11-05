"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Segmented } from "../ui";
import { TradBotConsole } from "../tradbot/TradBotConsole";
import { JarvisChat } from "./JarvisChat";
import { useJarvisChat } from "./useJarvisChat";

/** Dockable side panel; on small screens it covers the page. */
export function JarvisPanel({ onClose }: { onClose: () => void }) {
  const chat = useJarvisChat();
  const ref = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<"coach" | "tradbot">("coach");

  useEffect(() => {
    ref.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      ref={ref}
      id="jarvis-panel"
      aria-label="AI Coach"
      className="fixed inset-x-0 top-13 bottom-0 z-30 flex flex-col border-l border-line bg-surface md:left-auto md:w-[400px] xl:sticky xl:top-13 xl:h-[calc(100dvh-3.25rem)] xl:shrink-0"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-[15px] font-medium">AI Coach</h2>
          <p className="text-[12px] text-muted">Reflective journaling companion</p>
        </div>
        <div className="flex gap-1">
          <Link href="/jarvis" className="inline-flex h-8 items-center px-2 text-[13px] text-ink-soft hover:bg-raised hover:text-ink">
            Open full view
          </Link>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close the AI Coach">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>
          </Button>
        </div>
      </div>
      <div className="px-4 pb-2">
        <Segmented
          label="Which assistant"
          value={mode}
          onChange={setMode}
          options={[
            { value: "coach", label: "Journal coach" },
            { value: "tradbot", label: "TradBot-I live" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 border-t border-line">
        {/* Both stay mounted so switching never drops a reply or the mic. */}
        <div className={mode === "coach" ? "h-full" : "hidden"}>
          <JarvisChat chat={chat} compact />
        </div>
        <div className={mode === "tradbot" ? "h-full" : "hidden"}>
          <TradBotConsole compact />
        </div>
      </div>
    </aside>
  );
}
