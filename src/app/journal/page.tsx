"use client";

import { useRef, useState } from "react";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { dateTime, money, rFmt, toneOf } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { Trade } from "@/lib/domain/types";
import { Duplicates, type DuplicatePair } from "@/components/journal/Duplicates";
import { ImportDialog } from "@/components/journal/ImportDialog";
import { PnlIssue, SideBadge, SourceBadge, StatusBadge } from "@/components/journal/badges";
import { useTradeActions } from "@/components/journal/useTradeActions";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, Card, EmptyState, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

export default function JournalPage() {
  return (
    <Suspended>
      <Journal />
    </Suspended>
  );
}

const PAGE_SIZES = ["25", "50", "100", "200"];
const MAX_BULK = 500;

function SortHeader({ k, label, sort, dir, onSort, className }: { k: string; label: string; sort: string; dir: string; onSort: (k: string) => void; className?: string }) {
  const active = sort === k;
  return (
    <th scope="col" className={cx("px-3 py-2 font-normal", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={cx("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
        {label}
        {active && <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden className={dir === "asc" ? "" : "rotate-180"}><path d="M4 1l3.5 6h-7z" /></svg>}
      </button>
    </th>
  );
}

function RowAction({ label, d, onClick, danger }: { label: string; d: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx("rounded p-1.5 text-muted hover:bg-raised", danger ? "hover:text-loss" : "hover:text-ink")}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
    </button>
  );
}

function Journal() {
  const { accounts, editTrade, openTrade, dataVersion } = useApp();
  const { deleteTrades, duplicateTrade } = useTradeActions();
  const filters = useUrlFilters();
  const { get, set } = filters;

  const view = get("view") === "duplicates" ? "duplicates" : "trades";
  const page = Number(get("page")) || 1;
  const pageSize = PAGE_SIZES.includes(get("pageSize")) ? get("pageSize") : "50";
  const sort = get("sort") || "openedAt";
  const dir = get("dir") || "desc";

  const { data, error, loading, reload } = useFetch<{ trades: Trade[]; total: number }>(`/api/trades?${filters.apiQuery({ extra: { page: String(page), pageSize, sort, dir } })}`);
  // Only when asked for: finding pairs compares trades with each other, which takes seconds on a big journal.
  const dupes = useFetch<{ pairs: DuplicatePair[] }>(view === "duplicates" ? "/api/reconcile" : null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState(get("q"));
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onSearch = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => set({ q: value.trim() }), 300);
  };
  const barFilters = { ...filters, clear: () => { setSearch(""); clearTimeout(searchTimer.current); filters.clear(); } };

  const trades = data?.trades ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / Number(pageSize)));
  const pageIds = trades.map((t) => t.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const id of pageIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const sortBy = (k: string) => set({ sort: k, dir: sort === k && dir === "desc" ? "asc" : "desc" });
  const curOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency;
  const dupeCount = dupes.data?.pairs.length ?? 0;
  const sh = { sort, dir, onSort: sortBy };

  return (
    <>
      <PageHeader
        title="Journal"
        actions={
          <>
            <Button onClick={() => set({ import: "1" })}>Import</Button>
            <Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>
          </>
        }
      />

      <div className="mb-4">
        <Segmented
          label="Journal view"
          value={view}
          onChange={(v) => set({ view: v === "duplicates" ? "duplicates" : null })}
          options={[{ value: "trades", label: "All trades" }, { value: "duplicates", label: dupeCount ? `Possible duplicates (${dupeCount})` : "Possible duplicates" }]}
        />
      </div>

      {view === "duplicates" ? (
        dupes.data ? <Duplicates key={dataVersion} pairs={dupes.data.pairs} /> : dupes.error ? <EmptyState title="Couldn't check for duplicates" body={dupes.error} action={<Button onClick={dupes.reload}>Try again</Button>} /> : <Spinner />
      ) : (
        <>
          <TradeFilters filters={barFilters} source outcome plan>
            <div className="col-span-2 sm:w-64">
              <label htmlFor="journal-search" className="sr-only">Search trades</label>
              <input id="journal-search" type="search" className={inputClass} placeholder="Search symbol, setup, notes, tags, #id" value={search} onChange={(e) => onSearch(e.target.value)} />
            </div>
          </TradeFilters>

          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-panel border border-line-strong bg-raised px-3.5 py-2 text-[14px]" role="region" aria-label="Bulk actions">
              <span>{selected.size} selected</span>
              <Button size="sm" variant="danger" disabled={selected.size > MAX_BULK} title={selected.size > MAX_BULK ? `Up to ${MAX_BULK} at a time` : undefined} onClick={async () => { await deleteTrades([...selected]); setSelected(new Set()); }}>Delete selected</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
          )}

          {error && !data ? (
            <EmptyState title="Couldn't load your trades" body={error} action={<Button onClick={reload}>Try again</Button>} />
          ) : !data ? (
            <Spinner />
          ) : total > 0 && trades.length === 0 ? (
            <EmptyState title="Nothing on this page any more" body="There are fewer trades than before, so this page is empty." action={<Button onClick={() => set({ page: lastPage > 1 ? String(lastPage) : null })}>Go to the last page</Button>} />
          ) : total === 0 ? (
            filters.active ? (
              <EmptyState title="No trades match" body="Try a different search, or clear the filters." action={<Button onClick={barFilters.clear}>Clear filters</Button>} />
            ) : (
              <EmptyState title="Your journal is empty" body="Log a trade by hand, import a CSV from your platform, or link MetaTrader 5 under Accounts & MT5." action={<><Button onClick={() => set({ import: "1" })}>Import</Button><Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button></>} />
            )
          ) : (
            <Card className={cx("overflow-hidden transition-opacity", loading && "opacity-70")}>
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <caption className="sr-only">Trades, page {page} of {lastPage}, {total} in all</caption>
                  <thead className="border-b border-line text-left text-[13px] text-muted">
                    <tr>
                      <th scope="col" className="w-9 py-2 pr-1 pl-3">
                        <input type="checkbox" aria-label="Select every trade on this page" checked={allSelected} onChange={togglePage} className="accent-[var(--accent)]" />
                      </th>
                      <SortHeader {...sh} k="symbol" label="Trade" />
                      <SortHeader {...sh} k="openedAt" label="Opened" className="hidden sm:table-cell" />
                      <SortHeader {...sh} k="closedAt" label="Closed" className="hidden xl:table-cell" />
                      <th scope="col" className="hidden px-3 py-2 font-normal lg:table-cell">Strategy</th>
                      <th scope="col" className="hidden px-3 py-2 font-normal md:table-cell">Status</th>
                      <SortHeader {...sh} k="quantity" label="Size" className="hidden text-right lg:table-cell" />
                      <SortHeader {...sh} k="pnl" label="P&L" className="text-right" />
                      <SortHeader {...sh} k="rMultiple" label="R" className="hidden text-right sm:table-cell" />
                      <th scope="col" className="hidden w-32 py-2 pr-2 font-normal md:table-cell"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {trades.map((t) => (
                      <tr key={t.id} className={cx("hover:bg-raised/50", selected.has(t.id) && "bg-accent-soft")}>
                        <td className="py-2 pr-1 pl-3">
                          <input type="checkbox" aria-label={`Select trade #${t.id}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--accent)]" />
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" className="flex flex-wrap items-center gap-1.5 text-left font-medium hover:text-accent" onClick={() => openTrade(t.id)}>
                            {t.symbol}
                            <SideBadge side={t.side} />
                            <SourceBadge source={t.source} />
                          </button>
                          <span className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted sm:hidden">{dateTime(t.openedAt)} <span className="md:hidden"><StatusBadge status={t.status} /></span></span>
                        </td>
                        <td className="num hidden px-3 py-2 text-[13px] whitespace-nowrap text-ink-soft sm:table-cell">{dateTime(t.openedAt)}</td>
                        <td className="num hidden px-3 py-2 text-[13px] whitespace-nowrap text-ink-soft xl:table-cell">{dateTime(t.closedAt)}</td>
                        <td className="hidden max-w-36 truncate px-3 py-2 text-[13.5px] text-ink-soft lg:table-cell">{t.strategy || <span className="text-muted">—</span>}</td>
                        <td className="hidden px-3 py-2 md:table-cell"><StatusBadge status={t.status} /></td>
                        <td className="num hidden px-3 py-2 text-right text-[13px] text-ink-soft lg:table-cell">{t.quantity}</td>
                        <td className={`num px-3 py-2 text-right whitespace-nowrap ${toneOf(t.pnl)}`}>
                          {t.pnlStatus !== "ok" ? <PnlIssue status={t.pnlStatus} /> : t.pnl === null ? <span className="text-muted">—</span> : money(t.pnl, curOf(t), true)}
                        </td>
                        <td className="num hidden px-3 py-2 text-right text-[13px] text-ink-soft sm:table-cell">{rFmt(t.rMultiple)}</td>
                        <td className="hidden py-1 pr-2 text-right whitespace-nowrap md:table-cell">
                          <RowAction label={`View trade #${t.id}`} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z" onClick={() => openTrade(t.id)} />
                          <RowAction label={`Edit trade #${t.id}`} d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" onClick={() => editTrade(t.id)} />
                          <RowAction label={`Duplicate trade #${t.id}`} d="M9 9h11v11H9zM5 15H4V4h11v1" onClick={() => void duplicateTrade(t.id)} />
                          <RowAction label={`Delete trade #${t.id}`} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" danger onClick={() => void deleteTrades([t.id])} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2 text-[13px] text-muted">
                <span className="num">{((page - 1) * Number(pageSize) + 1).toLocaleString()} to {Math.min(page * Number(pageSize), total).toLocaleString()} of {total.toLocaleString()}</span>
                <span className="flex items-center gap-2">
                  <label htmlFor="page-size">Per page</label>
                  <select id="page-size" className={cx(inputClass, "h-8 w-auto")} value={pageSize} onChange={(e) => set({ pageSize: e.target.value })}>
                    {PAGE_SIZES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <Button size="sm" disabled={page <= 1} onClick={() => set({ page: page > 2 ? String(page - 1) : null })}>Previous</Button>
                  <Button size="sm" disabled={page >= lastPage} onClick={() => set({ page: String(page + 1) })}>Next</Button>
                </span>
              </div>
            </Card>
          )}
        </>
      )}

      <ImportDialog open={get("import") === "1"} onClose={() => set({ import: null })} />
    </>
  );
}
