"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { zoneInstant, zoneParts } from "@/lib/domain/zone";
import { useApp } from "./app-state";

export const DATE_PRESETS = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "This year" },
  { value: "custom", label: "Custom" },
];

/** Midnights in the chosen zone, so a range means the days the trader sees, across DST changes too. */
function dateWindow(range: string, from: string, to: string, tz?: string): { from?: string; to?: string } {
  const today = zoneParts(Date.now(), tz);
  const midnight = (y: number, m: number, d: number) => zoneInstant(y, m, d, 0, 0, tz);
  const daysAgo = (n: number) => new Date(midnight(today.year, today.month, today.day - n)).toISOString();
  if (range === "today") return { from: daysAgo(0) };
  if (range === "7d") return { from: daysAgo(6) };
  if (range === "30d") return { from: daysAgo(29) };
  if (range === "90d") return { from: daysAgo(89) };
  if (range === "ytd") return { from: new Date(midnight(today.year, 1, 1)).toISOString() };
  if (range === "custom") {
    const ymd = (s: string) => s.split("-").map(Number);
    const out: { from?: string; to?: string } = {};
    if (from) out.from = new Date(midnight(ymd(from)[0], ymd(from)[1], ymd(from)[2])).toISOString();
    if (to) out.to = new Date(midnight(ymd(to)[0], ymd(to)[1], ymd(to)[2] + 1) - 1).toISOString();
    return out;
  }
  return {};
}

const EXTRA_KEYS = ["side", "session", "tag", "mistake", "emotion", "grade", "assetClass", "rMin", "rMax", "holdMin", "holdMax"];
const API_KEYS = ["accountId", "symbol", "strategy", "source", "outcome", "plan", "includeSample", "currency", "unit", "q", "weekday", "hour", "closedOnly", ...EXTRA_KEYS];
const FILTER_KEYS = [...API_KEYS.filter((k) => k !== "includeSample" && k !== "currency" && k !== "unit"), "range", "from", "to", "closedFrom", "closedTo"];
/** What follows you from page to page. The rest belongs to one link or one screen. */
const GLOBAL_KEYS = ["range", "from", "to", "accountId", "symbol", "strategy", "source", "outcome", "plan", "includeSample", "currency", "unit", ...EXTRA_KEYS];
const STORE = "jarvis-filters";

/** Per tab. Storage can be blocked, and the filters then just stay on their own page. */
function readStored(): string {
  try {
    return sessionStorage.getItem(STORE) ?? "";
  } catch {
    return "";
  }
}

function writeStored(value: string) {
  try {
    sessionStorage.setItem(STORE, value);
  } catch {}
}

export const forgetFilters = () => writeStored("");

export type UrlFilters = ReturnType<typeof useUrlFilters>;

/**
 * Filters live in the URL, so refreshing or sharing a link keeps them, and they follow you to the next
 * filtered page opened with none of its own. Needs a Suspense boundary above it.
 */
export function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();
  const tz = useApp().settings?.timeZone || undefined;

  const restoring = useRef<boolean | null>(null);
  // Next keeps a visited page alive while hidden, so coming back to one counts as arriving again.
  useEffect(() => () => {
    restoring.current = null;
  }, []);
  useEffect(() => {
    const current = new URLSearchParams(search);
    const held = new URLSearchParams(GLOBAL_KEYS.flatMap((k) => (current.get(k) ? [[k, current.get(k) as string]] : [])));
    if (restoring.current === null) {
      restoring.current = !held.size && Boolean(readStored());
      if (restoring.current) {
        for (const [k, v] of new URLSearchParams(readStored())) current.set(k, v);
        router.replace(`${pathname}?${current.toString()}`, { scroll: false });
        return;
      }
    }
    // Until the restored filters reach the URL, it still shows none: that isn't the user clearing them.
    if (restoring.current && !held.size) return;
    restoring.current = false;
    writeStored(held.toString());
  }, [search, router, pathname]);

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  /** The query for /api/trades and /api/analytics. With { dates: false } it covers all time. */
  const apiQuery = useCallback(
    (opts: { dates?: boolean; extra?: Record<string, string> } = {}) => {
      const current = new URLSearchParams(search);
      const out = new URLSearchParams();
      for (const k of API_KEYS) {
        const v = current.get(k);
        if (v) out.set(k, v);
      }
      if (opts.dates !== false) {
        const w = dateWindow(current.get("range") ?? "", current.get("from") ?? "", current.get("to") ?? "", tz);
        if (w.from) out.set("from", w.from);
        if (w.to) out.set("to", w.to);
      }
      // Days in the chosen zone, turned into instants here like the open-date range.
      const closed = dateWindow("custom", current.get("closedFrom") ?? "", current.get("closedTo") ?? "", tz);
      if (closed.from) out.set("closedFrom", closed.from);
      if (closed.to) out.set("closedTo", closed.to);
      for (const [k, v] of Object.entries(opts.extra ?? {})) if (v) out.set(k, v);
      return out.toString();
    },
    [search, tz],
  );

  return useMemo(
    () => ({
      get: (k: string) => new URLSearchParams(search).get(k) ?? "",
      set,
      apiQuery,
      clear: () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))),
      active: FILTER_KEYS.some((k) => new URLSearchParams(search).get(k)),
    }),
    [search, set, apiQuery],
  );
}
