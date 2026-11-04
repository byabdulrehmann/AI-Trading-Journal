import "server-only";
import { db } from "../db";

/**
 * Adapter to a running TradBot-I (the user's own Jarvis) through the remote
 * dashboard it already ships (dashboard/server.py, port 8000). Kestrel acts as
 * one more paired remote client, exactly like the phone dashboard:
 *
 *   POST /login {pin}          → bearer token (PIN from the HUD's Remote Control)
 *   POST /api/command {text}   → typed message into the live Gemini session
 *   WS   /ws?token=            → log / status / sys events (replays last 50)
 *   WS   /ws/phone-audio?token= → 16 kHz mono PCM16 mic audio into the session
 *
 * Jarvis's spoken replies play on the computer running TradBot-I, in the voice
 * chosen in its HUD; the dashboard API does not stream reply audio. The bearer
 * token stays on this server and is never sent to the browser.
 */

export type TradBotEvent = {
  id: number;
  type: "log" | "status" | "sys" | "wake" | "file_received" | string;
  speaker?: "user" | "jarvis" | string;
  text?: string;
  state?: string;
  ts: string;
};

export interface TradBotStatus {
  url: string;
  reachable: boolean | null;
  paired: boolean;
  link: "disconnected" | "connecting" | "connected";
  /** Live session state as last reported by TradBot-I. */
  session: "unknown" | "active" | "reconnecting";
  micStreaming: boolean;
  error: string | null;
}

type Listener = (msg: { kind: "event"; event: TradBotEvent } | { kind: "status"; status: TradBotStatus } | { kind: "reset" }) => void;

const TOKEN_KEY = "tradbot_session";
const AUDIO_IDLE_MS = 1500;
const MAX_EVENTS = 200;

class TradBotBridge {
  readonly url = (process.env.TRADBOT_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
  private token: string | null = null;
  private tokenLoaded = false;
  private events: TradBotEvent[] = [];
  private nextId = 1;
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private link: TradBotStatus["link"] = "disconnected";
  private session: TradBotStatus["session"] = "unknown";
  private reachable: boolean | null = null;
  private error: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  private audioWs: WebSocket | null = null;
  private audioOpening: Promise<WebSocket> | null = null;
  private audioIdle: ReturnType<typeof setTimeout> | null = null;

  // ---------- token persistence (server-side only) ----------

  private getToken(): string | null {
    if (!this.tokenLoaded) {
      const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(TOKEN_KEY) as { value: string } | undefined;
      this.token = row ? (JSON.parse(row.value) as string) : null;
      this.tokenLoaded = true;
    }
    return this.token;
  }

  private setToken(token: string | null) {
    this.token = token;
    this.tokenLoaded = true;
    if (token)
      db()
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(TOKEN_KEY, JSON.stringify(token));
    else db().prepare("DELETE FROM settings WHERE key = ?").run(TOKEN_KEY);
  }

  // ---------- status ----------

  status(): TradBotStatus {
    return {
      url: this.url,
      reachable: this.reachable,
      paired: Boolean(this.getToken()),
      link: this.link,
      session: this.session,
      micStreaming: Boolean(this.audioWs && this.audioWs.readyState === WebSocket.OPEN),
      error: this.error,
    };
  }

  private emitStatus() {
    const status = this.status();
    for (const l of this.listeners) l({ kind: "status", status });
  }

  /** Cheap reachability check against the dashboard's public login page. */
  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/login`, { signal: AbortSignal.timeout(2000) });
      this.reachable = res.ok;
    } catch {
      this.reachable = false;
    }
    if (!this.reachable && this.link === "disconnected") this.error = null;
    this.emitStatus();
    return this.reachable;
  }

  // ---------- pairing ----------

  async pair(pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      this.reachable = false;
      this.emitStatus();
      return { ok: false, error: `TradBot-I isn't reachable at ${this.url}. Is it running?` };
    }
    this.reachable = true;
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string };
    if (!res.ok || !data.ok || !data.token) return { ok: false, error: data.error || "TradBot-I rejected the key." };
    this.setToken(data.token);
    this.error = null;
    this.retryDelay = 1000;
    this.connectEvents(true);
    return { ok: true };
  }

  forget() {
    this.setToken(null);
    this.closeEvents();
    this.closeAudio();
    this.session = "unknown";
    this.events = [];
    for (const l of this.listeners) l({ kind: "reset" });
    this.emitStatus();
  }

  /** Called when TradBot-I rejects the token (it keeps tokens in memory, so a restart invalidates them). */
  private tokenRejected() {
    this.setToken(null);
    this.closeEvents();
    this.closeAudio();
    this.session = "unknown";
    this.error = "TradBot-I no longer recognises this pairing (it was probably restarted). Enter a new key from Remote Control.";
    this.emitStatus();
  }

  // ---------- text commands ----------

  async command(text: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    const token = this.getToken();
    if (!token) return { ok: false, error: "Not paired with TradBot-I.", status: 409 };
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/command`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      this.reachable = false;
      this.emitStatus();
      return { ok: false, error: "TradBot-I didn't respond. Check that it's still running.", status: 502 };
    }
    if (res.status === 401) {
      this.tokenRejected();
      return { ok: false, error: this.error!, status: 401 };
    }
    if (!res.ok) return { ok: false, error: `TradBot-I returned an error (${res.status}).`, status: 502 };
    return { ok: true };
  }

  // ---------- event stream ----------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.getToken() && this.link === "disconnected") this.connectEvents(false);
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot() {
    return { status: this.status(), events: this.events };
  }

  private wsUrl(path: string, token: string) {
    return `${this.url.replace(/^http/, "ws")}${path}?token=${encodeURIComponent(token)}`;
  }

  private connectEvents(force: boolean) {
    const token = this.getToken();
    if (!token) return;
    if (this.ws && !force) return;
    this.closeEvents();
    this.link = "connecting";
    this.emitStatus();
    const ws = new WebSocket(this.wsUrl("/ws", token));
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.reachable = true;
      this.link = "connected";
      this.error = null;
      this.retryDelay = 1000;
      // TradBot-I replays its last 50 events on connect; start the buffer fresh.
      this.events = [];
      for (const l of this.listeners) l({ kind: "reset" });
      this.emitStatus();
    };
    ws.onmessage = (m) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (data.type === "status" && typeof data.state === "string")
        this.session = data.state === "active" ? "active" : data.state === "reconnecting" ? "reconnecting" : "unknown";
      const event: TradBotEvent = {
        id: this.nextId++,
        type: String(data.type ?? "unknown"),
        speaker: typeof data.speaker === "string" ? data.speaker : undefined,
        text: typeof data.text === "string" ? data.text : undefined,
        state: typeof data.state === "string" ? data.state : undefined,
        ts: typeof data.ts === "string" ? data.ts : new Date().toISOString(),
      };
      this.events = [...this.events.slice(-(MAX_EVENTS - 1)), event];
      for (const l of this.listeners) l({ kind: "event", event });
      if (data.type === "status") this.emitStatus();
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.link = "disconnected";
      this.session = "unknown";
      if (e.code === 4001) return this.tokenRejected();
      if (!opened) this.reachable = false;
      this.emitStatus();
      // Reconnect while someone is watching; back off up to 15 s.
      if (this.listeners.size > 0 && this.getToken()) {
        this.retryTimer = setTimeout(() => this.connectEvents(false), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 15000);
      }
    };
    ws.onerror = () => {
      // onclose follows and handles state.
    };
  }

  private closeEvents() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.link = "disconnected";
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
  }

  // ---------- microphone audio ----------

  private openAudio(token: string): Promise<WebSocket> {
    if (this.audioWs?.readyState === WebSocket.OPEN) return Promise.resolve(this.audioWs);
    this.audioOpening ??= new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl("/ws/phone-audio", token));
      ws.binaryType = "arraybuffer";
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("timeout"));
      }, 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.audioWs = ws;
        this.emitStatus();
        resolve(ws);
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (this.audioWs === ws) this.audioWs = null;
        if (e.code === 4001) this.tokenRejected();
        else this.emitStatus();
        reject(new Error(`closed ${e.code}`));
      };
    }).finally(() => {
      this.audioOpening = null;
    });
    return this.audioOpening;
  }

  /** Forwards one chunk of 16 kHz mono little-endian PCM16 to TradBot-I. */
  async sendAudio(pcm: ArrayBuffer): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    const token = this.getToken();
    if (!token) return { ok: false, error: "Not paired with TradBot-I.", status: 409 };
    let ws: WebSocket;
    try {
      ws = await this.openAudio(token);
    } catch {
      return { ok: false, error: this.error ?? "Couldn't open TradBot-I's microphone channel.", status: 502 };
    }
    ws.send(pcm);
    if (this.audioIdle) clearTimeout(this.audioIdle);
    // Closing after a pause lets TradBot-I hand the microphone back to the PC.
    this.audioIdle = setTimeout(() => this.closeAudio(), AUDIO_IDLE_MS);
    return { ok: true };
  }

  closeAudio() {
    if (this.audioIdle) clearTimeout(this.audioIdle);
    this.audioIdle = null;
    const ws = this.audioWs;
    this.audioWs = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    this.emitStatus();
  }
}

const g = globalThis as unknown as { __tradbot?: TradBotBridge };
/** One bridge per server process; survives dev hot reloads. */
export function tradbot(): TradBotBridge {
  g.__tradbot ??= new TradBotBridge();
  return g.__tradbot;
}
