"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";

export interface TradBotStatus {
  url: string;
  reachable: boolean | null;
  paired: boolean;
  link: "disconnected" | "connecting" | "connected";
  session: "unknown" | "active" | "reconnecting";
  micStreaming: boolean;
  error: string | null;
}

export interface TradBotEvent {
  id: number;
  type: string;
  speaker?: string;
  text?: string;
  state?: string;
  ts: string;
}

/**
 * Live view of the paired TradBot-I: an EventSource for its feed plus a
 * reachability poll while it isn't connected. Everything goes through
 * the Jarvis server; the browser never talks to TradBot-I directly.
 */
export function useTradBot() {
  const [status, setStatus] = useState<TradBotStatus | null>(null);
  const [events, setEvents] = useState<TradBotEvent[]>([]);
  const [streamError, setStreamError] = useState(false);

  const checkStatus = useCallback(
    () => api<TradBotStatus>("/api/tradbot/status").then(setStatus, () => setStreamError(true)),
    [],
  );

  useEffect(() => {
    const es = new EventSource("/api/tradbot/events");
    es.addEventListener("snapshot", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: TradBotStatus; events: TradBotEvent[] };
      setStatus(d.status);
      setEvents(d.events);
      setStreamError(false);
    });
    es.addEventListener("status", (e) => setStatus(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("event", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TradBotEvent;
      setEvents((xs) => [...xs.slice(-199), ev]);
    });
    es.addEventListener("reset", () => setEvents([]));
    es.onerror = () => setStreamError(true);
    api<TradBotStatus>("/api/tradbot/status").then(setStatus, () => setStreamError(true));
    return () => es.close();
  }, []);

  // Poll while TradBot-I is down or unpaired, so starting it shows up without a reload.
  const linked = status?.paired && status.link === "connected";
  useEffect(() => {
    if (linked) return;
    const t = setInterval(() => void checkStatus(), 5000);
    return () => clearInterval(t);
  }, [linked, checkStatus]);

  return { status, events, streamError, checkStatus };
}

export type MicState = "idle" | "requesting" | "live" | "denied" | "unsupported" | "error";

const TARGET_RATE = 16000;
const FLUSH_SAMPLES = 4096; // 256 ms at 16 kHz
const MAX_BACKLOG = 8; // ~2 s; older audio is dropped rather than replayed late

/** Same resampling and PCM16 conversion as TradBot-I's own dashboard (_f32toPcm16). */
function toPcm16(f32: Float32Array, srcRate: number): Int16Array {
  let s = f32;
  if (srcRate !== TARGET_RATE) {
    const ratio = srcRate / TARGET_RATE;
    const len = Math.round(f32.length / ratio);
    s = new Float32Array(len);
    for (let i = 0; i < len; i++) s[i] = f32[Math.min(Math.round(i * ratio), f32.length - 1)];
  }
  const out = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768)));
  return out;
}

/**
 * Captures the browser microphone and streams it to TradBot-I via
 * POST /api/tradbot/audio, in order, one chunk at a time.
 */
export function useTradBotMic(onError: (message: string) => void) {
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const parts = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioNode; sink: GainNode } | null>(null);
  const queue = useRef<Int16Array[]>([]);
  const sending = useRef(false);
  const live = useRef(false);

  const teardown = useCallback(() => {
    live.current = false;
    const p = parts.current;
    parts.current = null;
    queue.current = [];
    if (p) {
      try {
        p.node.disconnect();
        p.sink.disconnect();
      } catch {}
      p.stream.getTracks().forEach((t) => t.stop());
      void p.ctx.close().catch(() => {});
    }
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    teardown();
    setState("idle");
    void fetch("/api/tradbot/audio", { method: "DELETE" }).catch(() => {});
  }, [teardown]);

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (live.current && queue.current.length) {
        const chunk = queue.current.shift()!;
        const res = await fetch("/api/tradbot/audio", {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: chunk.buffer as ArrayBuffer,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          teardown();
          setState("error");
          onError(data.error ?? `Microphone stream failed (${res.status}).`);
          return;
        }
      }
    } catch {
      teardown();
      setState("error");
      onError("Lost the connection to the Jarvis server while streaming audio.");
    } finally {
      sending.current = false;
    }
  }, [onError, teardown]);

  const start = useCallback(async () => {
    if (live.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setState(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "error");
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) onError(e instanceof Error ? e.message : "Couldn't open the microphone.");
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") await ctx.resume();
    const rate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);
    const code = `class K extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice());return true}}registerProcessor('kestrel-mic',K);`;
    const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } catch {
      URL.revokeObjectURL(url);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      setState("unsupported");
      return;
    }
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, "kestrel-mic");
    let buf: Int16Array[] = [];
    let len = 0;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!live.current) return;
      const pcm = toPcm16(e.data, rate);
      buf.push(pcm);
      len += pcm.length;
      if (len >= FLUSH_SAMPLES) {
        const out = new Int16Array(len);
        let off = 0;
        let sq = 0;
        for (const c of buf) {
          out.set(c, off);
          off += c.length;
        }
        for (let i = 0; i < out.length; i++) sq += (out[i] / 32768) ** 2;
        setLevel(Math.min(1, Math.sqrt(sq / out.length) * 4));
        buf = [];
        len = 0;
        queue.current.push(out);
        if (queue.current.length > MAX_BACKLOG) queue.current.splice(0, queue.current.length - MAX_BACKLOG);
        void pump();
      }
    };
    src.connect(node);
    // Worklets only run when connected to an output; a muted gain keeps the mic off the speakers.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink);
    sink.connect(ctx.destination);
    parts.current = { ctx, stream, node, sink };
    live.current = true;
    setState("live");
  }, [onError, pump]);

  useEffect(() => () => teardown(), [teardown]);

  return { state, level, start, stop };
}
