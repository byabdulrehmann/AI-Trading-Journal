"use client";

import { useState } from "react";
import type { Facets } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { DATE_PRESETS, type UrlFilters } from "@/lib/client/filters";
import { useFetch } from "@/lib/client/use-fetch";
import { cx } from "./ui";

const SOURCES = [
  ["", "Any source"],
  ["manual", "Manual"],
  ["csv", "Imported"],
  ["mt5", "MT5"],
  ["sample", "Sample"],
];
const OUTCOMES = [
  ["", "Any outcome"],
  ["win", "Winners"],
  ["loss", "Losers"],
  ["breakeven", "Breakeven"],
  ["open", "Open or partial"],
  ["pending", "P&L pending"],
];
const PLANS = [
  ["", "Any plan answer"],
  ["on", "On plan"],
  ["off", "Off plan"],
  ["unanswered", "Not answered"],
];

/** Text-weight controls that hug their value. A set filter carries the orange underline, so the line itself says what's on. */
const quiet = (on: boolean) =>
  cx(
    "h-11 w-full min-w-0 border-b border-line bg-transparent px-1 text-[16px] transition-colors hover:text-ink sm:h-8 sm:w-auto sm:max-w-44 sm:border-b-0 sm:text-[13px] sm:[field-sizing:content]",
    on ? "text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted",
  );

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} className={quiet(Boolean(value))} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** The shared filter bar. Filters live in the URL query; see useUrlFilters. */
export function TradeFilters({ filters, dates = true, source, outcome, plan, children }: { filters: UrlFilters; dates?: boolean; source?: boolean; outcome?: boolean; plan?: boolean; children?: React.ReactNode }) {
  const { accounts } = useApp();
  const { data: facets } = useFetch<Facets>("/api/facets");
  const { get, set } = filters;
  const [open, setOpen] = useState(false);
  const range = get("range");

  const accountId = get("accountId");
  const includeSample = get("includeSample") === "1";
  const viewingSample = get("source") === "sample" || Boolean(accounts.find((a) => String(a.id) === accountId)?.isSample);
  const sampleHidden = facets?.hasSample && !includeSample && !viewingSample && !accountId;

  const nameOf = (options: string[][], v: string) => options.find(([k]) => k === v)?.[1] ?? v;
  const rangeLabel = range === "custom" ? [get("from"), get("to")].filter(Boolean).join(" to ") || "Custom" : DATE_PRESETS.find((p) => p.value === range)?.label;
  const active = [
    range && rangeLabel,
    accountId && accounts.find((a) => String(a.id) === accountId)?.name,
    get("symbol"),
    get("strategy"),
    get("source") && nameOf(SOURCES, get("source")),
    get("outcome") && nameOf(OUTCOMES, get("outcome")),
    get("plan") && nameOf(PLANS, get("plan")),
    get("q") && `"${get("q")}"`,
  ].filter(Boolean) as string[];

  // The word row only fits beside three selects. With more filters, or dates showing, it folds into one select.
  const crowded = Boolean(source || outcome || plan) || range === "custom";

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {children}
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="h-11 border border-line-strong px-3 text-[14px] text-ink sm:hidden">
          Filters{active.length > 0 && <span className="num ml-1.5 text-accent">{active.length}</span>}
        </button>
        {filters.active && (
          <button type="button" onClick={filters.clear} className="order-last h-11 px-2 text-[14px] text-ink-soft underline underline-offset-2 hover:text-ink sm:ml-auto sm:h-8 sm:text-[13px]">
            Clear
          </button>
        )}
        {active.length > 0 && <p className="w-full truncate text-[13px] text-ink-soft sm:hidden">{active.join(", ")}</p>}
        <div className={cx(open ? "grid w-full grid-cols-2 gap-x-3" : "hidden", "sm:contents")}>
          {dates &&
            (crowded ? (
              <Select label="Date range, by open time" value={range} onChange={(v) => set({ range: v, from: null, to: null })} options={DATE_PRESETS.map((p) => [p.value, p.label])} />
            ) : (
              <div role="radiogroup" aria-label="Date range, by open time" className="col-span-2 flex overflow-x-auto [scrollbar-width:none] sm:mr-2">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={range === p.value}
                    onClick={() => set({ range: p.value, from: null, to: null })}
                    className={cx("h-11 px-2 text-[14px] whitespace-nowrap transition-colors sm:h-8 sm:text-[13px]", range === p.value ? "text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:text-ink")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ))}
          {range === "custom" && (
            <span className="col-span-2 flex items-center gap-1.5 text-[13px] text-muted sm:mr-2">
              <input type="date" aria-label="From date" className="num h-11 min-w-0 flex-1 border-b border-line-strong bg-transparent px-1 text-[16px] text-ink sm:h-8 sm:flex-none sm:text-[13px]" value={get("from")} max={get("to") || undefined} onChange={(e) => set({ from: e.target.value })} />
              to
              <input type="date" aria-label="To date" className="num h-11 min-w-0 flex-1 border-b border-line-strong bg-transparent px-1 text-[16px] text-ink sm:h-8 sm:flex-none sm:text-[13px]" value={get("to")} min={get("from") || undefined} onChange={(e) => set({ to: e.target.value })} />
            </span>
          )}
          <Select label="Account" value={accountId} onChange={(v) => set({ accountId: v })} options={[["", "All accounts"], ...accounts.map((a) => [String(a.id), a.name + (a.isSample ? " (sample)" : "") + (a.archived ? " (archived)" : "")])]} />
          <Select label="Instrument" value={get("symbol")} onChange={(v) => set({ symbol: v })} options={[["", "All instruments"], ...(facets?.symbols ?? []).map((s) => [s, s])]} />
          <Select label="Strategy" value={get("strategy")} onChange={(v) => set({ strategy: v })} options={[["", "All strategies"], ...(facets?.strategies ?? []).map((s) => [s, s])]} />
          {source && <Select label="Source" value={get("source")} onChange={(v) => set({ source: v })} options={SOURCES} />}
          {outcome && <Select label="Outcome" value={get("outcome")} onChange={(v) => set({ outcome: v })} options={OUTCOMES} />}
          {plan && <Select label="Plan" value={get("plan")} onChange={(v) => set({ plan: v })} options={PLANS} />}
        </div>
      </div>
      {sampleHidden && (
        <p role="note" className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
          Sample trades are hidden, so what you see here is only your own record.
          <button type="button" className="min-h-11 text-ink-soft underline underline-offset-2 hover:text-ink sm:min-h-6" onClick={() => set({ includeSample: "1" })}>Include sample data</button>
        </p>
      )}
      {(includeSample || viewingSample) && facets?.hasSample && (
        <p role="note" className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-info">
          These figures include made-up sample trades. They aren&apos;t real results.
          {includeSample && <button type="button" className="min-h-11 text-ink-soft underline underline-offset-2 hover:text-ink sm:min-h-6" onClick={() => set({ includeSample: null })}>Hide sample data</button>}
        </p>
      )}
    </div>
  );
}
