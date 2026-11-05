"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { MEMORY_KINDS } from "@/lib/domain/types";
import { Button, cx, inputClass } from "../ui";
import { RichText } from "./RichText";
import { useJarvisChat, type UiMessage } from "./useJarvisChat";

interface ActiveInfo {
  active: { provider: string; label: string; model: string; fallbackReason: string | null };
  providers: { id: string; external: boolean }[];
}

const STARTERS = [
  "What patterns do you see in my recent trades?",
  "How well have I stuck to my plans?",
  "Summarise my last two weeks.",
  "/models",
];

export function useActiveModel() {
  const [info, setInfo] = useState<ActiveInfo | null>(null);
  const reload = useCallback(
    () => api<ActiveInfo>("/api/jarvis/providers").then(setInfo, () => setInfo(null)),
    [],
  );
  useEffect(() => {
    api<ActiveInfo>("/api/jarvis/providers").then(setInfo, () => setInfo(null));
  }, []);
  return { info, reload };
}

export function JarvisChat({
  chat,
  compact,
  onModelSwitched,
}: {
  chat: ReturnType<typeof useJarvisChat>;
  compact?: boolean;
  onModelSwitched?: () => void;
}) {
  const { jarvisRequest, takeJarvisRequest, settings } = useApp();
  const { info, reload } = useActiveModel();
  const [draft, setDraft] = useState("");
  const [showShared, setShowShared] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastNonce = useRef<number | null>(null);
  const { messages, busy, meta, send, stop } = chat;

  // Requests from elsewhere in the app ("Review with Jarvis"); each is sent once,
  // even when effects run twice (React dev mode) or another chat view mounts.
  useEffect(() => {
    if (!jarvisRequest || busy || lastNonce.current === jarvisRequest.nonce) return;
    lastNonce.current = jarvisRequest.nonce;
    const req = takeJarvisRequest();
    if (req) void send(req.prompt, req.focusTradeId);
  }, [jarvisRequest, busy, send, takeJarvisRequest]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Refresh the header after a "/model" switch completes.
  const last = messages.at(-1);
  useEffect(() => {
    if (last && !last.streaming && last.provider === "kestrel") {
      void reload();
      onModelSwitched?.();
    }
  }, [last, reload, onModelSwitched]);

  const submit = () => {
    if (!draft.trim()) return;
    void send(draft);
    setDraft("");
  };

  const active = info?.active;
  const external = info?.providers.find((p) => p.id === active?.provider)?.external;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="min-w-0 truncate text-[13px] text-ink-soft">{active ? <>{active.label}, <span className="num">{active.model}</span></> : "Checking model…"}</span>
        {external === false && <span className="text-[12px] text-muted">Stays on this computer</span>}
        <button type="button" onClick={() => setShowShared((s) => !s)} aria-expanded={showShared} className="ml-auto text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
          What&apos;s shared?
        </button>
      </div>
      {active?.fallbackReason && (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-[12.5px] text-ink">
          Using demo mode: {active.fallbackReason}{" "}
          <Link href="/settings#jarvis" className="underline">
            Settings
          </Link>
        </p>
      )}
      {showShared && (
        <div className="border-b border-line bg-sunken px-4 py-3 text-[13px] text-ink-soft">
          {external ? (
            <>
              <p className="mb-1 font-medium text-ink">Each message sends {active?.label} only:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {(meta?.disclosure ?? ["Send a message to see the exact list for this request."]).map((d) => (
                  <li key={d}>{d}</li>
                ))}
                <li>The last 20 messages of this conversation</li>
              </ul>
            </>
          ) : (
            <p>Demo mode makes no network calls. Replies are built from your records on this computer.</p>
          )}
          <p className="mt-2">
            Sharing level: <span className="font-medium text-ink">{settings?.jarvis.sharing.replaceAll("_", " ")}</span>.{" "}
            <Link href="/settings#privacy" className="underline">
              Change it
            </Link>
          </p>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-[14px] text-ink-soft">
              I can review what you&apos;ve recorded, point out patterns, and help you reflect on decisions. I don&apos;t see live markets, and I won&apos;t tell you what to trade.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="border border-line-strong px-3 py-1.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-raised hover:text-ink pointer-coarse:py-3">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.key} m={m} compact={compact} />
        ))}
      </div>

      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="jarvis-input" className="sr-only">
          Message the AI Coach
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="jarvis-input"
            rows={compact ? 2 : 3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about your trades, or type /models"
            className={cx(inputClass, "h-auto min-h-10 resize-none py-2")}
            maxLength={4000}
          />
          {busy ? (
            <Button onClick={stop} aria-label="Stop generating">
              Stop
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={!draft.trim()}>
              Send
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">Reflective, educational only, not financial or psychological advice.</p>
      </form>
    </div>
  );
}

function MessageView({ m, compact }: { m: UiMessage; compact?: boolean }) {
  const { toast, settings } = useApp();
  const [remembering, setRemembering] = useState(false);
  const [memText, setMemText] = useState("");
  const [kind, setKind] = useState<(typeof MEMORY_KINDS)[number]>("observation");

  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-raised px-3 py-2 text-[14px] whitespace-pre-wrap text-ink">{m.content}</div>
      </div>
    );

  const saveMemory = async () => {
    try {
      const ids = [...m.content.matchAll(/\[#(\d+)\]/g)].map((x) => Number(x[1])).slice(0, 20);
      await api("/api/jarvis/memories", { method: "POST", json: { kind, content: memText, evidenceTradeIds: ids, source: "user" } });
      toast({ message: "Saved to memory. Manage it on the AI Coach page.", tone: "success" });
      setRemembering(false);
      setMemText("");
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't save.", tone: "error" });
    }
  };

  return (
    <div className="animate-rise">
      <div className={cx("text-[14px] leading-relaxed text-ink", compact ? "" : "max-w-3xl")}>
        {m.error && <p className="mb-2 border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">{m.error}</p>}
        {m.content ? <RichText text={m.content} /> : m.streaming ? <span className="typing-caret text-muted">Thinking</span> : null}
        {m.streaming && m.content && <span className="typing-caret" aria-hidden />}
      </div>
      {!m.streaming && m.content && m.provider !== "kestrel" && (
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] text-muted">
          {m.model && <span>{m.provider === "demo" ? "Demo mode" : m.model}</span>}
          {settings?.jarvis.memoryEnabled && (
            <button type="button" className="whitespace-nowrap hover:text-ink" onClick={() => setRemembering((r) => !r)} aria-expanded={remembering}>
              Remember something from this
            </button>
          )}
        </div>
      )}
      {remembering && (
        <div className="mt-2 space-y-2 border-y border-line py-3">
          <label className="block text-[12.5px] text-ink-soft" htmlFor={`mem-${m.key}`}>
            In your words, what should the coach remember? You can edit or delete it later.
          </label>
          <textarea id={`mem-${m.key}`} rows={2} className={cx(inputClass, "h-auto py-2")} value={memText} onChange={(e) => setMemText(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Memory type" className={cx(inputClass, "!w-auto")} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {MEMORY_KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <Button size="sm" variant="primary" onClick={saveMemory} disabled={memText.trim().length < 3}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemembering(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
