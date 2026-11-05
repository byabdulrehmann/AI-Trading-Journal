"use client";

import type { Facets } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { DATE_PRESETS, type UrlFilters } from "@/lib/client/filters";
import { useFetch } from "@/lib/client/use-fetch";
import { Badge, Button, Notice, cx, inputClass } from "./ui";

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

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} className={cx(inputClass, "sm:w-auto sm:max-w-44", value && "border-accent/60")} value={value} onChange={(e) => onChange(e.target.value)}>
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
  const range = get("range");

  const accountId = get("accountId");
  const includeSample = get("includeSample") === "1";
  const viewingSample = get("source") === "sample" || Boolean(accounts.find((a) => String(a.id) === accountId)?.isSample);
  const sampleHidden = facets?.hasSample && !includeSample && !viewingSample && !accountId;

  return (
    <div className="mb-5 space-y-2.5">
      {dates && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Date range, by open time" className="inline-flex max-w-full overflow-x-auto rounded-control border border-line-strong bg-sunken p-0.5 [scrollbar-width:none]">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={range === p.value}
                onClick={() => set({ range: p.value, from: null, to: null })}
                className={cx("rounded px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors", range === p.value ? "bg-raised text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink")}
              >
                {p.label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <input type="date" aria-label="From date" className={cx(inputClass, "w-auto")} value={get("from")} max={get("to") || undefined} onChange={(e) => set({ from: e.target.value })} />
              to
              <input type="date" aria-label="To date" className={cx(inputClass, "w-auto")} value={get("to")} min={get("from") || undefined} onChange={(e) => set({ to: e.target.value })} />
            </span>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        {children}
        <Select label="Account" value={accountId} onChange={(v) => set({ accountId: v })} options={[["", "All accounts"], ...accounts.map((a) => [String(a.id), a.name + (a.isSample ? " (sample)" : "") + (a.archived ? " (archived)" : "")])]} />
        <Select label="Instrument" value={get("symbol")} onChange={(v) => set({ symbol: v })} options={[["", "All instruments"], ...(facets?.symbols ?? []).map((s) => [s, s])]} />
        <Select label="Strategy" value={get("strategy")} onChange={(v) => set({ strategy: v })} options={[["", "All strategies"], ...(facets?.strategies ?? []).map((s) => [s, s])]} />
        {source && <Select label="Source" value={get("source")} onChange={(v) => set({ source: v })} options={SOURCES} />}
        {outcome && <Select label="Outcome" value={get("outcome")} onChange={(v) => set({ outcome: v })} options={OUTCOMES} />}
        {plan && <Select label="Plan" value={get("plan")} onChange={(v) => set({ plan: v })} options={PLANS} />}
        {filters.active && (
          <Button variant="ghost" size="sm" onClick={filters.clear}>
            Clear filters
          </Button>
        )}
      </div>
      {sampleHidden && (
        <Notice tone="info" action={<Button size="sm" onClick={() => set({ includeSample: "1" })}>Include sample data</Button>}>
          Sample trades are hidden, so what you see here is only your own record.
        </Notice>
      )}
      {(includeSample || viewingSample) && facets?.hasSample && (
        <Notice tone="info" action={includeSample && <Button size="sm" onClick={() => set({ includeSample: null })}>Hide sample data</Button>}>
          <Badge tone="info">Sample</Badge> These figures include made-up sample trades. They aren&apos;t real results.
        </Notice>
      )}
    </div>
  );
}
