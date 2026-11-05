"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export const DATE_PRESETS = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "ytd", label: "This year" },
  { value: "custom", label: "Custom" },
];

/** Local midnights, so a range means the days the trader sees, across DST changes too. */
function dateWindow(range: string, from: string, to: string): { from?: string; to?: string } {
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).toISOString();
  if (range === "today") return { from: daysAgo(0) };
  if (range === "7d") return { from: daysAgo(6) };
  if (range === "30d") return { from: daysAgo(29) };
  if (range === "90d") return { from: daysAgo(89) };
  if (range === "ytd") return { from: new Date(today.getFullYear(), 0, 1).toISOString() };
  if (range === "custom") {
    const ymd = (s: string) => s.split("-").map(Number);
    const out: { from?: string; to?: string } = {};
    if (from) out.from = new Date(ymd(from)[0], ymd(from)[1] - 1, ymd(from)[2]).toISOString();
    if (to) out.to = new Date(ymd(to)[0], ymd(to)[1] - 1, ymd(to)[2] + 1, 0, 0, 0, -1).toISOString();
    return out;
  }
  return {};
}

const API_KEYS = ["accountId", "symbol", "strategy", "source", "outcome", "plan", "includeSample", "currency", "q"];
const FILTER_KEYS = [...API_KEYS.filter((k) => k !== "includeSample" && k !== "currency"), "range", "from", "to"];

export type UrlFilters = ReturnType<typeof useUrlFilters>;

/** Filters live in the URL, so refreshing or sharing a link keeps them. Needs a Suspense boundary above it. */
export function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = params.toString();

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
        const w = dateWindow(current.get("range") ?? "", current.get("from") ?? "", current.get("to") ?? "");
        if (w.from) out.set("from", w.from);
        if (w.to) out.set("to", w.to);
      }
      for (const [k, v] of Object.entries(opts.extra ?? {})) if (v) out.set(k, v);
      return out.toString();
    },
    [search],
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
