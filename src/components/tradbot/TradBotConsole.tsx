"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { Badge, Button, Spinner, cx, inputClass } from "../ui";
import { useTradBot, useTradBotMic, type MicState, type TradBotEvent, type TradBotStatus } from "./useTradBot";

const WAIT_MS = 45_000;

/**
 * Remote console for the user's own TradBot-I Jarvis. It shows TradBot-I's
 * conversation feed, sends typed messages, and streams the browser mic into
 * its live session. Replies are spoken by TradBot-I itself on its computer.
 */
export function TradBotConsole({ compact }: { compact?: boolean }) {
  const { toast } = useApp();
  const { status, events, streamError, checkStatus } = useTradBot();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  // TradBot-I broadcasts spoken input but not typed dashboard commands, so typed messages are echoed locally.
  const [sent, setSent] = useState<TradBotEvent[]>([]);
  const feed = [...events, ...sent].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const listRef = useRef<HTMLDivElement>(null);
  const onMicError = useCallback((m: string) => setMicError(m), []);
  const mic = useTradBotMic(onMicError);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events, sent, waitingSince]);

  // A Jarvis reply after we sent something ends the wait.
  const lastJarvis = [...events].reverse().find((e) => e.type === "log" && e.speaker === "jarvis");
  const replied = waitingSince !== null && lastJarvis && Date.parse(lastJarvis.ts) >= waitingSince - 1000;
  useEffect(() => {
    if (waitingSince === null) return;
    const t = setTimeout(() => setWaitingSince(null), WAIT_MS);
    return () => clearTimeout(t);
  }, [waitingSince]);
  const waiting = waitingSince !== null && !replied;

  // If the link drops while the mic is on, the audio route returns an error and the mic stops itself.
  const linked = Boolean(status?.paired && status.link === "connected");

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api("/api/tradbot/command", { method: "POST", json: { text } });
      setDraft("");
      const now = Date.now();
      setSent((xs) => [...xs.slice(-49), { id: -now, type: "log", speaker: "user", text, ts: new Date(now).toISOString() }]);
      setWaitingSince(now);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't reach TradBot-I.", tone: "error" });
    } finally {
      setSending(false);
    }
  };

  if (!status) return <div className="p-4"><Spinner label="Looking for TradBot-I" /></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <StatusBar status={status} streamError={streamError} mic={mic.state} />

      {!status.paired ? (
        status.reachable ? <PairForm onPaired={checkStatus} error={status.error} /> : <NotRunning status={status} onRetry={checkStatus} />
      ) : (
        <>
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {status.link !== "connected" && (
              <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">
                {status.link === "connecting" ? "Connecting to TradBot-I…" : `TradBot-I isn't answering at ${status.url}. Jarvis will reconnect when it's back.`}
              </p>
            )}
            {feed.length === 0 && status.link === "connected" && (
              <p className="text-[14px] text-ink-soft">
                Connected to your TradBot-I assistant. Type below or turn on the microphone. It replies out loud on the computer running TradBot-I, in the voice set in its HUD, and the words appear here.
              </p>
            )}
            {feed.map((e) => (
              <FeedItem key={e.id} e={e} />
            ))}
            {waiting && <p className="typing-caret text-[13px] text-muted">Waiting for TradBot-I</p>}
          </div>

          <div className="border-t border-line p-3">
            {micError && (
              <p role="alert" className="mb-2 rounded-md border border-loss/50 bg-loss-soft px-3 py-2 text-[12.5px]">
                {micError}
              </p>
            )}
            <MicHelp state={mic.state} />
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <MicButton state={mic.state} level={mic.level} disabled={!linked} onStart={() => { setMicError(null); void mic.start(); }} onStop={mic.stop} />
              <label htmlFor="tradbot-input" className="sr-only">Message TradBot-I</label>
              <textarea
                id="tradbot-input"
                rows={compact ? 1 : 2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={!linked}
                placeholder={linked ? "Message TradBot-I" : "Waiting for connection"}
                className={cx(inputClass, "h-auto min-h-10 resize-none py-2")}
                maxLength={4000}
              />
              <Button variant="primary" type="submit" disabled={!linked || !draft.trim() || sending}>
                {sending ? "…" : "Send"}
              </Button>
            </form>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
              <span>TradBot-I runs its own tools and memory, and sends audio and text to Google Gemini.</span>
              <button
                type="button"
                className="underline-offset-2 hover:text-ink hover:underline"
                onClick={async () => {
                  mic.stop();
                  await api("/api/tradbot/pair", { method: "DELETE" });
                  await checkStatus();
                }}
              >
                Unpair
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBar({ status, streamError, mic }: { status: TradBotStatus; streamError: boolean; mic: MicState }) {
  const [tone, label] = !status.reachable && !status.paired
    ? (["loss", "Not running"] as const)
    : !status.paired
      ? (["accent", "Not paired"] as const)
      : status.link === "connected"
        ? status.session === "reconnecting"
          ? (["accent", "TradBot-I reconnecting to Gemini"] as const)
          : (["profit", "Connected"] as const)
        : status.link === "connecting"
          ? (["accent", "Connecting"] as const)
          : (["loss", "Disconnected"] as const);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
      <Badge tone={tone}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        TradBot-I · {label}
      </Badge>
      {mic === "live" && <Badge tone="loss">● Mic live</Badge>}
      <span className="num ml-auto truncate text-[11.5px] text-muted">{status.url.replace(/^https?:\/\//, "")}</span>
      {streamError && <span className="w-full text-[12px] text-loss">Lost the live feed from the Jarvis server; retrying…</span>}
    </div>
  );
}

function FeedItem({ e }: { e: TradBotEvent }) {
  if (e.type === "log" && e.speaker === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-raised px-3.5 py-2 text-[14px] whitespace-pre-wrap ring-1 ring-line">{e.text}</div>
      </div>
    );
  if (e.type === "log")
    return (
      <div className="animate-rise">
        <p className="mb-0.5 text-[11.5px] font-semibold text-accent">TradBot-I</p>
        <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{e.text}</p>
      </div>
    );
  const text = e.type === "status" ? (e.state === "active" ? "Live session ready." : e.state === "reconnecting" ? "TradBot-I is reconnecting to Gemini…" : `Status: ${e.state}`) : e.type === "wake" ? "Wake word detected." : e.text ?? e.type;
  return <p className="text-center text-[12px] text-muted">{text}</p>;
}

function MicButton({ state, level, disabled, onStart, onStop }: { state: MicState; level: number; disabled: boolean; onStart: () => void; onStop: () => void }) {
  const live = state === "live";
  return (
    <button
      type="button"
      onClick={live ? onStop : onStart}
      disabled={disabled || state === "requesting"}
      aria-pressed={live}
      aria-label={live ? "Stop microphone" : "Start microphone"}
      title={live ? "Stop microphone" : "Talk to TradBot-I"}
      className={cx(
        "relative grid h-10 w-10 shrink-0 place-items-center rounded-md border transition-colors disabled:opacity-50",
        live ? "border-loss bg-loss-soft text-loss" : "border-line-strong bg-raised text-ink-soft hover:text-ink",
      )}
    >
      {state === "requesting" ? (
        <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          {live ? <rect x="7" y="7" width="10" height="10" rx="1.5" /> : <path d="M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zM5 11a7 7 0 0014 0M12 18v3" />}
        </svg>
      )}
      {live && <span aria-hidden className="absolute inset-x-1 bottom-0.5 h-0.5 origin-left rounded bg-loss transition-transform" style={{ transform: `scaleX(${Math.max(0.08, level)})` }} />}
    </button>
  );
}

function MicHelp({ state }: { state: MicState }) {
  if (state === "denied")
    return <p className="mb-2 text-[12.5px] text-loss">Microphone blocked. Allow it from the site settings next to the address bar, then try again.</p>;
  if (state === "unsupported")
    return <p className="mb-2 text-[12.5px] text-loss">This browser can&apos;t capture audio here. Use a current Chrome, Edge or Firefox on http://localhost.</p>;
  if (state === "live")
    return <p className="mb-2 text-[12.5px] text-muted">Listening. TradBot-I ignores mic audio while it is speaking, so wait for it to finish.</p>;
  return null;
}

function PairForm({ onPaired, error }: { onPaired: () => void; error: string | null }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/tradbot/pair", { method: "POST", json: { pin } });
      onPaired();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 p-4 text-[14px]">
      <p className="font-medium">TradBot-I is running. Pair Jarvis with it:</p>
      <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
        <li>In the TradBot-I window, press <strong>Remote Control</strong>.</li>
        <li>Type the 6-character key it shows (it expires after 10 minutes and works once).</li>
      </ol>
      {error && <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-[13px]">{error}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label htmlFor="tradbot-pin" className="sr-only">Remote Control key</label>
        <input
          id="tradbot-pin"
          className={cx(inputClass, "num w-36 tracking-[0.3em] uppercase")}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))}
          placeholder="ABC123"
          autoComplete="one-time-code"
        />
        <Button variant="primary" type="submit" disabled={pin.length !== 6 || busy}>{busy ? "Pairing…" : "Pair"}</Button>
      </form>
      {err && <p role="alert" className="text-[13px] text-loss">{err}</p>}
      <p className="text-[12.5px] text-muted">The pairing token stays on the Jarvis server. TradBot-I forgets it when it restarts, so you&apos;ll pair again then.</p>
    </div>
  );
}

function NotRunning({ status, onRetry }: { status: TradBotStatus; onRetry: () => void }) {
  return (
    <div className="space-y-3 p-4 text-[14px]">
      <p className="font-medium">TradBot-I isn&apos;t running</p>
      <p className="text-ink-soft">
        Jarvis couldn&apos;t reach TradBot-I&apos;s remote dashboard at <code className="num">{status.url}</code>. Everything else in Jarvis keeps working, including the AI Coach.
      </p>
      <p className="text-ink-soft">Start it in its own folder:</p>
      <pre className="num overflow-x-auto rounded-md bg-sunken p-3 text-[12.5px]">{`cd TradBot-I-main
.venv\\Scripts\\activate
python main.py`}</pre>
      <p className="text-[12.5px] text-muted">TradBot-I needs its Gemini key set up, a microphone and speakers on that computer. Its dashboard needs fastapi and uvicorn, which its setup installs.</p>
      <p className="text-[12.5px] text-muted">
        Already running but still unreachable? Unpatched TradBot-I can&apos;t start its dashboard without a console (for example from Auto-Start on Boot, which uses <code className="num">pythonw.exe</code>). Add <code className="num">log_config=None</code> to the two <code className="num">uvicorn.Config(...)</code> calls in its <code className="num">dashboard/server.py</code>, or start it with <code className="num">python.exe</code>. Run only one copy at a time.
      </p>
      <Button size="sm" onClick={onRetry}>Check again</Button>
    </div>
  );
}
