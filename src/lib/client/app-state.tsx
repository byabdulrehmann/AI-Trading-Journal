"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { reportingCurrencies, tradesInCurrency } from "@/lib/domain/metrics";
import type { Account, Settings, Trade } from "@/lib/domain/types";
import { api } from "./api";
import type { SettingsPatch } from "@/lib/server/repo/settings";

export interface Toast {
  id: number;
  message: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

interface JarvisRequest {
  prompt: string;
  focusTradeId: number | null;
  nonce: number;
}

interface AppState {
  trades: Trade[];
  /** Trades in the currency being reported. Use these for anything that adds up money. */
  reportTrades: Trade[];
  currency: string;
  currencies: string[];
  setReportCurrency: (currency: string) => void;
  accounts: Account[];
  settings: Settings | null;
  loading: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  saveSettings: (patch: SettingsPatch) => Promise<Settings | null>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  // Trade drawer
  openTradeId: number | null;
  openTrade: (id: number | null) => void;
  editing: Trade | "new" | null;
  editTrade: (t: Trade | "new" | null) => void;
  // Jarvis side panel
  jarvisOpen: boolean;
  setJarvisOpen: (open: boolean) => void;
  jarvisRequest: JarvisRequest | null;
  askJarvis: (prompt: string, focusTradeId?: number | null) => void;
  /** Marks the pending request as handled so no other chat view re-sends it. */
  takeJarvisRequest: () => JarvisRequest | null;
}

const Ctx = createContext<AppState | null>(null);

async function fetchAll() {
  const [j, s] = await Promise.all([
    api<{ trades: Trade[]; accounts: Account[] }>("/api/trades"),
    api<{ settings: Settings }>("/api/settings"),
  ]);
  return { trades: j.trades, accounts: j.accounts, settings: s.settings };
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openTradeId, openTrade] = useState<number | null>(null);
  const [editing, editTrade] = useState<Trade | "new" | null>(null);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [jarvisRequest, setJarvisRequest] = useState<JarvisRequest | null>(null);
  const [reportCurrency, setReportCurrency] = useState<string | null>(null);
  const toastId = useRef(0);

  const { currencies, primary } = useMemo(() => reportingCurrencies(accounts, trades), [accounts, trades]);
  const currency = (reportCurrency && currencies.includes(reportCurrency) ? reportCurrency : primary) ?? settings?.baseCurrency ?? "USD";
  const reportTrades = useMemo(() => tradesInCurrency(trades, accounts, currency), [trades, accounts, currency]);

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++toastId.current;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismissToast(id), t.action ? 8000 : 4500);
    },
    [dismissToast],
  );

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAll>>) => {
    setTrades(data.trades);
    setAccounts(data.accounts);
    setSettings(data.settings);
    setLoadError(null);
    setLoading(false);
  }, []);
  const onLoadError = useCallback((e: unknown) => {
    setLoadError(e instanceof Error ? e.message : "Couldn't load your journal.");
    setLoading(false);
  }, []);

  const refresh = useCallback(() => fetchAll().then(apply, onLoadError), [apply, onLoadError]);

  useEffect(() => {
    fetchAll().then(apply, onLoadError);
  }, [apply, onLoadError]);

  useEffect(() => {
    if (!settings) return;
    const el = document.documentElement;
    if (settings.theme === "system") el.removeAttribute("data-theme");
    else el.dataset.theme = settings.theme;
    try {
      localStorage.setItem("kestrel-theme", settings.theme);
    } catch {}
  }, [settings]);

  const saveSettings = useCallback(
    async (patch: SettingsPatch) => {
      try {
        const res = await api<{ settings: Settings }>("/api/settings", { method: "PATCH", json: patch });
        setSettings(res.settings);
        return res.settings;
      } catch (e) {
        toast({ message: e instanceof Error ? e.message : "Couldn't save settings.", tone: "error" });
        return null;
      }
    },
    [toast],
  );

  const askJarvis = useCallback((prompt: string, focusTradeId: number | null = null) => {
    setJarvisRequest({ prompt, focusTradeId, nonce: Date.now() });
    setJarvisOpen(true);
  }, []);

  const takeJarvisRequest = useCallback(() => {
    if (jarvisRequest) setJarvisRequest(null);
    return jarvisRequest;
  }, [jarvisRequest]);

  const value = useMemo<AppState>(
    () => ({
      trades, reportTrades, currency, currencies, setReportCurrency, accounts, settings, loading, loadError, refresh, saveSettings, toast, toasts, dismissToast,
      openTradeId, openTrade, editing, editTrade, jarvisOpen, setJarvisOpen, jarvisRequest, askJarvis, takeJarvisRequest,
    }),
    [trades, reportTrades, currency, currencies, accounts, settings, loading, loadError, refresh, saveSettings, toast, toasts, dismissToast, openTradeId, editing, jarvisOpen, jarvisRequest, askJarvis, takeJarvisRequest],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}

export function useCurrency(): string {
  return useApp().currency;
}
