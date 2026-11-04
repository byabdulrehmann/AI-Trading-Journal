"use client";

import { useApp } from "@/lib/client/app-state";
import { Segmented } from "./ui";

/** Shown only when accounts use different currencies: totals cover one currency at a time. */
export function CurrencyPicker() {
  const { currency, currencies, setReportCurrency } = useApp();
  if (currencies.length < 2) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[13px] text-muted">Totals in</span>
      <Segmented label="Currency for totals" value={currency} onChange={setReportCurrency} options={currencies.map((c) => ({ value: c, label: c }))} />
    </span>
  );
}
