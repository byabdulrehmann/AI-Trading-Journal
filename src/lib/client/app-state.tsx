"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Account, Settings } from "@/lib/domain/types";
import { api, goToLogin } from "./api";
import { setDisplayZone } from "./format";
import { forgetFilters } from "./filters";
import type { SettingsPatch } from "@/lib/server/repo/settings";

export interface Toast {
  id: number;
  message: string;
  tone?: "info" | "error" | "success";
  action?: { label: string; run: () => void };
}

export interface User {
  id: number;
  email: string;
  name: string;
  isOwner: boolean;
}

interface JarvisRequest {
  prompt: string;
  focusTradeId: number | null;
  nonce: number;
}

/** Shared state stays small: pages fetch their own trades and figures, and refetch when dataVersion moves. */
interface AppState {
  user: User | null;
  accounts: Account[];
  settings: Settings | null;
  loading: boolean;
  loadError: string | null;
  dataVersion: number;
  /** Rereads accounts and settings and tells every view to refetch. Call after any change to data. */
  refresh: () => Promise<void>;
  saveSettings: (patch: SettingsPatch) => Promise<Settings | null>;
  signOut: () => Promise<void>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  // Trade drawer and form
  openTradeId: number | null;
  openTrade: (id: number | null) => void;
  editing: number | "new" | null;
  editTrade: (t: number | "new" | null) => void;
  // AI Coach side panel
  jarvisOpen: boolean;
  setJarvisOpen: (open: boolean) => void;
  jarvisRequest: JarvisRequest | null;
  askJarvis: (prompt: string, focusTradeId?: number | null) => void;
  /** Marks the pending request as handled so no other chat view re-sends it. */
  takeJarvisRequest: () => JarvisRequest | null;
}

export const PUBLIC_PAGES = new Set(["/login", "/welcome"]);

const Ctx = createContext<AppState | null>(null);

async function fetchShared() {
  const [a, s] = await Promise.all([api<{ accounts: Account[] }>("/api/accounts"), api<{ settings: Settings }>("/api/settings")]);
  return { accounts: a.accounts, settings: s.settings };
}

let nextToastId = 0;

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openTradeId, openTrade] = useState<number | null>(null);
  const [editing, editTrade] = useState<number | "new" | null>(null);
  const [jarvisOpen, setJarvisOpen] = useState(false);
  const [jarvisRequest, setJarvisRequest] = useState<JarvisRequest | null>(null);

  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++nextToastId;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismissToast(id), t.action ? 8000 : 4500);
    },
    [dismissToast],
  );

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchShared>>) => {
    setAccounts(data.accounts);
    setSettings(data.settings);
    setLoadError(null);
    setLoading(false);
  }, []);
  const onLoadError = useCallback((e: unknown) => {
    setLoadError(e instanceof Error ? e.message : "Couldn't load your journal.");
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    await fetchShared().then(apply, onLoadError);
    setDataVersion((v) => v + 1);
  }, [apply, onLoadError]);

  // /login and /welcome work signed out, so check rather than assume. Signing in reloads the page, so once is enough.
  const startedOnPublicPage = PUBLIC_PAGES.has(pathname);
  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me").then((me) => {
      setUser(me.user);
      if (me.user) return fetchShared().then(apply, onLoadError);
      setLoading(false);
      if (!startedOnPublicPage) goToLogin();
    }, onLoadError);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load, wherever it started
  }, []);

  // During render, so children format with the right zone on the render that first has it.
  setDisplayZone(settings?.timeZone);

  useEffect(() => {
    if (!settings) return;
    const el = document.documentElement;
    if (settings.theme === "system") el.removeAttribute("data-theme");
    else el.dataset.theme = settings.theme;
    try {
      localStorage.setItem("jarvis-theme", settings.theme);
      localStorage.removeItem("kestrel-theme");
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

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    forgetFilters();
    goToLogin();
  }, []);

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
      user, accounts, settings, loading, loadError, dataVersion, refresh, saveSettings, signOut, toast, toasts, dismissToast,
      openTradeId, openTrade, editing, editTrade, jarvisOpen, setJarvisOpen, jarvisRequest, askJarvis, takeJarvisRequest,
    }),
    [user, accounts, settings, loading, loadError, dataVersion, refresh, saveSettings, signOut, toast, toasts, dismissToast, openTradeId, editing, jarvisOpen, jarvisRequest, askJarvis, takeJarvisRequest],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}
