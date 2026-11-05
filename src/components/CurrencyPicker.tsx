"use client";

import type { UrlFilters } from "@/lib/client/filters";
import { Segmented } from "./ui";

/** Shown only when several currencies are in play: totals cover one currency at a time. */
export function CurrencyPicker({ currency, currencies, filters }: { currency: string; currencies: string[]; filters: UrlFilters }) {
  if (currencies.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px] text-muted">Totals in</span>
      <Segmented label="Currency for totals" value={currency} onChange={(c) => filters.set({ currency: c })} options={currencies.map((c) => ({ value: c, label: c }))} />
    </span>
  );
}
