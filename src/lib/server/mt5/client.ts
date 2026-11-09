import "server-only";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { RawDeal, RawOrder } from "./normalize";

export type SessionCategory = "wrong_password" | "invalid_server" | "terminal_missing" | "no_connection" | "no_symbol" | "timeout" | "other";

export interface SessionPayload {
  account: Record<string, unknown> & { login: number; currency: string; company: string; balance: number; equity: number; margin: number; margin_free: number; margin_level: number; profit: number; leverage: number; margin_mode: number; trade_allowed: boolean };
  positions: (Record<string, unknown> & { identifier: number; symbol: string; type: number; volume: number; price_open: number; price_current: number; sl: number; tp: number; swap: number; profit: number; time: number; time_msc: number })[];
  orders: RawOrder[];
  deals: RawDeal[];
  history_orders: RawOrder[];
  symbols: Record<string, { name: string; trade_contract_size: number; digits: number; point: number; trade_tick_size: number; trade_tick_value: number; currency_base: string; currency_profit: string }>;
  quote_time: number | null;
  utc_now: number;
}

export type SessionResult = { ok: true; payload: SessionPayload } | { ok: false; category: SessionCategory; code?: number | null };

export interface SessionRequest {
  login: number;
  server: string;
  password: string;
  /** Seconds. */
  from: number;
}

// Built at runtime: left untraced, or the build reads data/mt5-terminal, whose files the running terminal keeps locked.
const ROOT = /*turbopackIgnore: true*/ process.cwd();
const PYTHON = path.join(/*turbopackIgnore: true*/ ROOT, "services", "mt5", ".venv", "Scripts", "python.exe");
const SERVICE = path.join(/*turbopackIgnore: true*/ ROOT, "services", "mt5", "service.py");
const TERMINAL_DIR = path.join(/*turbopackIgnore: true*/ ROOT, "data", "mt5-terminal");
const TERMINAL = path.join(/*turbopackIgnore: true*/ TERMINAL_DIR, "terminal64.exe");
// Longer than the service's own initialize, login and history waits together, shorter than fetch's 300s limit.
const SESSION_TIMEOUT_MS = 280_000;
const IDLE_MS = 10 * 60_000;

interface Service {
  child: ChildProcess;
  port: number;
  token: string;
}

const g = globalThis as unknown as { __jarvisMt5?: { service: Service | null; queue: Promise<unknown>; idle?: NodeJS.Timeout; lastLogin?: string } };
const state = (g.__jarvisMt5 ??= { service: null, queue: Promise.resolve() });

/** The child gets only what Windows and Python need, so the encryption and AI keys stay out of it. */
function childEnv(token: string) {
  const env = { MT5_SERVICE_TOKEN: token, MT5_TERMINAL_PATH: TERMINAL } as unknown as NodeJS.ProcessEnv;
  for (const k of ["SystemRoot", "windir", "TEMP", "TMP", "PATH", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "USERNAME"]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function spawnService(): Promise<Service> {
  const token = randomBytes(32).toString("hex");
  const child = spawn(PYTHON, ["-I", SERVICE], { env: childEnv(token), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service did not start")), 20_000);
    child.once("error", (e) => (clearTimeout(timer), reject(e)));
    child.once("exit", () => {
      clearTimeout(timer);
      if (state.service?.child === child) state.service = null;
      reject(new Error("service exited"));
    });
    child.stdout!.once("data", (d) => {
      clearTimeout(timer);
      const port = Number(String(d).trim());
      if (Number.isInteger(port) && port > 0) resolve({ child, port, token });
      else reject(new Error("service printed no port"));
    });
  });
}

/** The terminal keeps logins it was given, in its own folder. A tree kill leaves no chance to clean up there. */
function forgetSavedLogins() {
  try {
    rmSync(path.join(/*turbopackIgnore: true*/ TERMINAL_DIR, "Config", "accounts.dat"), { force: true });
  } catch {
    // Still locked: the service removes it again before the next start.
  }
}

/** Ends the service and the dedicated terminal under it. A tree kill can only reach our own children. */
export function stopService(): Promise<void> {
  const service = state.service;
  state.service = null;
  clearTimeout(state.idle);
  if (!service?.child.pid) {
    forgetSavedLogins();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(service.child.pid), "/T", "/F"], { windowsHide: true }, () => {
      forgetSavedLogins();
      resolve();
    });
  });
}

/** [time in the broker's clock, open, high, low, close, tick volume]. */
export type RawBar = [number, number, number, number, number, number];
export type BarsRequest = SessionRequest & { symbol: string; timeframe: "M1" | "M5" | "M15" | "H1"; to: number };
export type BarsResult = { ok: true; bars: RawBar[] } | { ok: false; category: SessionCategory; code?: number | null };

async function call<T extends { ok: boolean; category?: SessionCategory; code?: number | null }>(endpoint: "/session" | "/bars", req: SessionRequest, onData: (data: T) => T): Promise<T | { ok: false; category: SessionCategory; code?: number | null }> {
  // A terminal left signed in might accept the next login without checking it, so never reuse one across accounts.
  const who = `${req.login}@${req.server}`;
  if (state.lastLogin && state.lastLogin !== who) await stopService();
  state.lastLogin = who;
  if (!existsSync(PYTHON) || !existsSync(TERMINAL)) return { ok: false, category: "terminal_missing" };
  clearTimeout(state.idle);
  try {
    state.service ??= await spawnService();
  } catch {
    return { ok: false, category: "terminal_missing" };
  }
  const { port, token } = state.service;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mt5-token": token },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
    const data = (await res.json()) as T;
    state.idle = setTimeout(() => void stopService(), IDLE_MS);
    state.idle.unref();
    // The service's message is deliberately dropped: only the category and code leave this file.
    return data.ok ? onData(data) : { ok: false, category: data.category ?? "other", code: data.code };
  } catch (err) {
    await stopService(); // A hung terminal: the next session starts a new service and terminal.
    return { ok: false, category: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "other" };
  }
}

/** One at a time across the whole server, because the terminal holds one login. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = state.queue.then(job);
  state.queue = run.catch(() => undefined);
  return run;
}

export function runSession(req: SessionRequest): Promise<SessionResult> {
  return enqueue(async () => {
    const r = await call<{ ok: boolean } & SessionPayload>("/session", req, (d) => d);
    return r.ok ? { ok: true, payload: r as unknown as SessionPayload } : (r as Exclude<SessionResult, { ok: true }>);
  });
}

export function fetchBars(req: BarsRequest): Promise<BarsResult> {
  return enqueue(async () => {
    const r = await call<{ ok: boolean; bars: RawBar[] }>("/bars", req, (d) => d);
    return r.ok ? { ok: true, bars: (r as { bars: RawBar[] }).bars } : (r as Exclude<BarsResult, { ok: true }>);
  });
}
