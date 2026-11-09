"use client";

import { createPortal } from "react-dom";
import { useApp } from "@/lib/client/app-state";
import { DATE_PRESETS, type UrlFilters } from "@/lib/client/filters";
import { currencySymbol } from "@/lib/client/format";
import { useElement } from "@/lib/client/use-stored";
import { Caret, Dropdown, ICONS, Icon } from "@/components/Dropdown";
import { TradeFilters } from "@/components/TradeFilters";
import { cx } from "@/components/ui";

const segment = "flex h-[38px] items-center gap-2 px-3 text-[13px] font-medium text-ink hover:bg-raised max-sm:px-2.5";
/** Keys the Filters menu sets, so its count leaves out date, account and currency, which have their own controls. */
const FILTER_KEYS = ["symbol", "strategy", "source", "outcome", "plan", "side", "session", "assetClass", "tag", "mistake", "emotion", "grade", "rMin", "rMax", "holdMin", "holdMax", "unit", "q"];

/** The dashboard's controls, drawn in the shell's top bar. Each one writes the shared URL filters. */
export function TopControls({ filters, currency, currencies, unitNote }: { filters: UrlFilters; currency: string; currencies: string[]; unitNote: string | null }) {
  const { accounts } = useApp();
  const slot = useElement("topbar-slot");
  if (!slot) return null;

  const { get, set } = filters;
  const range = get("range");
  const accountId = get("accountId");
  const account = accounts.find((a) => String(a.id) === accountId);
  const count = FILTER_KEYS.filter((k) => get(k)).length;
  const rangeLabel = range === "custom" ? [get("from"), get("to")].filter(Boolean).join(" – ") || "Custom" : DATE_PRESETS.find((p) => p.value === range && p.value)?.label ?? "Date range";
  const glyph = currencySymbol(currency).trim();

  return createPortal(
    <>
      <Dropdown
        label={`Currency for totals: ${currency}`}
        className="flex h-[38px] items-center gap-1.5 rounded-full border border-line bg-surface pr-2.5 pl-1.5 hover:bg-raised"
        button={
          <>
            <span className="grid size-[26px] place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{glyph.length > 2 ? currency.slice(0, 1) : glyph}</span>
            <Caret />
          </>
        }
        panelClassName="w-56"
      >
        {(close) => (
          <div role="radiogroup" aria-label="Currency for totals" data-testid="currency-menu">
            <p className="mb-1.5 text-[12.5px] font-semibold text-ink">Totals in</p>
            {currencies.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === currency} onClick={() => (set({ currency: c }), close())} className={cx("flex w-full items-center justify-between rounded-control px-2 py-1.5 text-[13px] hover:bg-raised", c === currency ? "font-semibold text-accent" : "text-ink")}>
                {c}
                {c === currency && <span aria-hidden>✓</span>}
              </button>
            ))}
            <p className="mt-1.5 text-[12px] text-muted">Totals never mix currencies. {currencies.length < 2 ? "Accounts in another currency would be listed here." : ""}</p>
          </div>
        )}
      </Dropdown>
      <div className="flex max-w-full items-stretch divide-x divide-line rounded-lg border border-line bg-surface">
        <Dropdown
          label={count ? `Filters, ${count} on` : "Filters"}
          className={cx(segment, "rounded-l-lg")}
          button={
            <>
              <Icon d={ICONS.filter} size={15} className="text-ink-soft" />
              <span className="max-sm:sr-only">Filters</span>
              {count > 0 && <span className="num rounded-full bg-accent px-1.5 text-[10.5px] leading-4 text-white">{count}</span>}
              <Caret />
            </>
          }
          panelClassName="w-[min(680px,calc(100vw-24px))] max-sm:fixed max-sm:inset-x-3 max-sm:top-28 max-sm:w-auto"
        >
          {() => (
            <div data-testid="filters-menu">
              <p className="mb-2 text-[13px] font-semibold text-ink">Filters</p>
              <TradeFilters filters={filters} dates={false} outcome units unitNote={unitNote} />
            </div>
          )}
        </Dropdown>
        <Dropdown
          label={`Date range: ${rangeLabel === "Date range" ? "all time" : rangeLabel}`}
          className={segment}
          button={
            <>
              <Icon d={ICONS.date} size={15} className="text-ink-soft" />
              <span className="max-w-36 truncate max-sm:sr-only">{rangeLabel}</span>
              <Caret />
            </>
          }
          panelClassName="w-64"
        >
          {(close) => (
            <div data-testid="date-menu">
              <p className="mb-1.5 text-[12.5px] font-semibold text-ink">Date range, by open time</p>
              <div role="radiogroup" aria-label="Date range">
                {DATE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
                  <button key={p.value} type="button" role="radio" aria-checked={range === p.value} onClick={() => (set({ range: p.value || null, from: null, to: null }), close())} className={cx("flex w-full rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-raised", range === p.value ? "font-semibold text-accent" : "text-ink")}>
                    {p.label}
                  </button>
                ))}
              </div>
              <fieldset className="mt-2 border-t border-line pt-2">
                <legend className="sr-only">Custom range</legend>
                <label className="flex items-center justify-between gap-2 py-1 text-[12.5px] text-ink-soft">
                  From
                  <input type="date" aria-label="From date" className="h-8 rounded-control border border-line-strong bg-surface px-2 text-[13px] text-ink" value={get("from")} max={get("to") || undefined} onChange={(e) => set({ range: "custom", from: e.target.value })} />
                </label>
                <label className="flex items-center justify-between gap-2 py-1 text-[12.5px] text-ink-soft">
                  To
                  <input type="date" aria-label="To date" className="h-8 rounded-control border border-line-strong bg-surface px-2 text-[13px] text-ink" value={get("to")} min={get("from") || undefined} onChange={(e) => set({ range: "custom", to: e.target.value })} />
                </label>
              </fieldset>
            </div>
          )}
        </Dropdown>
        <Dropdown
          label={`Account: ${account?.name ?? "all accounts"}`}
          className={cx(segment, "rounded-r-lg")}
          button={
            <>
              <Icon d={ICONS.wallet} size={15} className="text-ink-soft" />
              <span className="max-w-36 truncate max-sm:sr-only">{account?.name ?? "All Accounts"}</span>
              <Caret />
            </>
          }
          panelClassName="w-64"
        >
          {(close) => (
            <div role="radiogroup" aria-label="Trading account" data-testid="account-menu">
              <p className="mb-1.5 text-[12.5px] font-semibold text-ink">Trading account</p>
              {[{ id: "", name: "All Accounts", note: "In one currency at a time" }, ...accounts.filter((a) => !a.archived).map((a) => ({ id: String(a.id), name: a.name, note: `${a.currency}${a.source === "backtest" ? ", backtest" : ""}${a.isSample ? ", sample" : ""}` }))].map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={accountId === a.id} onClick={() => (set({ accountId: a.id || null }), close())} className={cx("flex w-full items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-raised", accountId === a.id ? "font-semibold text-accent" : "text-ink")}>
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 text-[11.5px] font-normal text-muted">{a.note}</span>
                </button>
              ))}
            </div>
          )}
        </Dropdown>
      </div>
    </>,
    slot,
  );
}
