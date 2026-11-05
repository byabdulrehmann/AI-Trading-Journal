"use client";

import { useEffect, useRef, useState } from "react";
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
import { RowsSkeleton } from "@/components/tape/Skeletons";
import { TradeFilters } from "@/components/TradeFilters";
import { Button, EmptyState, Segmented, cx, inputClass } from "@/components/ui";

export default function JournalPage() {
  return (
    <Suspended>
      <Journal />
    </Suspended>
  );
}

const PAGE_SIZES = ["25", "50", "100", "200"];
const MAX_BULK = 500;
const checkbox = "size-3.5 appearance-none border border-line-strong bg-sunken align-middle checked:border-accent checked:bg-accent";
const headCell = "sticky top-13 z-10 bg-canvas py-1.5 font-normal whitespace-nowrap shadow-[inset_0_-1px_0_var(--line-strong)]";

function SortHeader({ k, label, sort, dir, onSort, className }: { k: string; label: string; sort: string; dir: string; onSort: (k: string) => void; className?: string }) {
  const active = sort === k;
  return (
    <th scope="col" className={cx(headCell, "px-2", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={cx("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
        {label}
        {active && <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden className={dir === "asc" ? "" : "rotate-180"}><path d="M4 1l3.5 6h-7z" /></svg>}
      </button>
    </th>
  );
}

function RowAction({ label, d, onClick, danger }: { label: string; d: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={cx("p-1.5 text-muted hover:bg-raised", danger ? "hover:text-loss" : "hover:text-ink")}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" aria-hidden><path d={d} /></svg>
    </button>
  );
}

const isTyping = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return el.type !== "checkbox" && el.type !== "radio";
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
};

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
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [search, setSearch] = useState(get("q"));
  const searchBox = useRef<HTMLInputElement>(null);
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

  // Re-subscribes each render, so the keys always read this page's rows and cursor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]")) return;
      if (e.key === "n") {
        e.preventDefault();
        editTrade("new");
        return;
      }
      if (view !== "trades") return;
      if (e.key === "/") {
        e.preventDefault();
        searchBox.current?.focus();
        return;
      }
      const at = pageIds.indexOf(cursorId ?? -1);
      if (e.key === "j" || e.key === "k") {
        if (pageIds.length === 0) return;
        e.preventDefault();
        const next = e.key === "j" ? Math.min(at + 1, pageIds.length - 1) : at < 0 ? 0 : Math.max(at - 1, 0);
        setCursorId(pageIds[next]);
        document.getElementById(`trade-row-${pageIds[next]}`)?.scrollIntoView({ block: "nearest" });
      } else if (at >= 0 && e.key === "x") {
        e.preventDefault();
        toggle(pageIds[at]);
      } else if (at >= 0 && e.key === "Enter" && !(e.target instanceof Element && e.target.closest("button, a, summary, input"))) {
        e.preventDefault();
        openTrade(pageIds[at]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <header className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <h1 className="text-[18px] leading-tight font-medium text-ink">Journal</h1>
        <Segmented
          label="Journal view"
          value={view}
          onChange={(v) => set({ view: v === "duplicates" ? "duplicates" : null })}
          options={[{ value: "trades", label: "All trades" }, { value: "duplicates", label: dupeCount ? `Possible duplicates (${dupeCount})` : "Possible duplicates" }]}
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button size="sm" className="max-sm:h-11" onClick={() => set({ import: "1" })}>Import</Button>
          <Button size="sm" className="max-sm:h-11" onClick={() => editTrade("new")}>Log trade</Button>
        </div>
      </header>

      {view === "duplicates" ? (
        dupes.data ? <Duplicates key={dataVersion} pairs={dupes.data.pairs} /> : dupes.error ? <EmptyState title="Couldn't check for duplicates" body={dupes.error} action={<Button onClick={dupes.reload}>Try again</Button>} /> : <RowsSkeleton rows={12} />
      ) : (
        <>
          <TradeFilters filters={barFilters} source outcome plan>
            <div className="w-full sm:mr-2 sm:w-56">
              <label htmlFor="journal-search" className="sr-only">Search trades</label>
              <input ref={searchBox} id="journal-search" type="search" className={cx(inputClass, "max-sm:h-11 sm:h-8 sm:text-[13px]")} placeholder="Symbol, setup, notes, tags, #id" value={search} onChange={(e) => onSearch(e.target.value)} />
            </div>
          </TradeFilters>

          {error && !data ? (
            <EmptyState title="Couldn't load your trades" body={error} action={<Button onClick={reload}>Try again</Button>} />
          ) : !data ? (
            <RowsSkeleton rows={14} />
          ) : total > 0 && trades.length === 0 ? (
            <EmptyState title="Nothing on this page any more" body="There are fewer trades than before, so this page is empty." action={<Button onClick={() => set({ page: lastPage > 1 ? String(lastPage) : null })}>Go to the last page</Button>} />
          ) : total === 0 ? (
            filters.active ? (
              <EmptyState title="No trades match" body="Try a different search, or clear the filters." action={<Button onClick={barFilters.clear}>Clear filters</Button>} />
            ) : (
              <EmptyState title="Your journal is empty" body="Log a trade by hand, import a CSV from your platform, or link MetaTrader 5 under Accounts & MT5." action={<><Button onClick={() => set({ import: "1" })}>Import</Button><Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button></>} />
            )
          ) : (
            <div className={cx("transition-opacity", loading && "opacity-70")}>
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">Trades, page {page} of {lastPage}, {total} in all</caption>
                <thead className="text-left text-[12.5px] text-muted">
                  <tr>
                    <th scope="col" className={cx(headCell, "w-8 pr-1")}>
                      <input type="checkbox" aria-label="Select every trade on this page" checked={allSelected} onChange={togglePage} className={checkbox} />
                    </th>
                    <SortHeader {...sh} k="symbol" label="Trade" />
                    <th scope="col" className={cx(headCell, "hidden px-2 md:table-cell")}>Side</th>
                    <SortHeader {...sh} k="openedAt" label="Opened" className="hidden sm:table-cell" />
                    <SortHeader {...sh} k="closedAt" label="Closed" className="hidden xl:table-cell" />
                    <th scope="col" className={cx(headCell, "hidden px-2 xl:table-cell")}>Strategy</th>
                    <th scope="col" className={cx(headCell, "hidden px-2 lg:table-cell")}>Source</th>
                    <th scope="col" className={cx(headCell, "hidden px-2 md:table-cell")}>Status</th>
                    <SortHeader {...sh} k="quantity" label="Size" className="hidden text-right lg:table-cell" />
                    <SortHeader {...sh} k="pnl" label="P&L" className="text-right" />
                    <SortHeader {...sh} k="rMultiple" label="R" className="hidden text-right sm:table-cell" />
                    <th scope="col" className={cx(headCell, "hidden w-28 md:table-cell")}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const here = cursorId === t.id;
                    return (
                      <tr
                        key={t.id}
                        id={`trade-row-${t.id}`}
                        aria-current={here ? "true" : undefined}
                        className={cx("group scroll-mt-24 scroll-mb-16 border-b border-line hover:bg-raised", selected.has(t.id) && "bg-accent-soft", here && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}
                      >
                        <td className="w-8 pr-1 pl-1">
                          <label className="-my-1 flex h-11 w-9 items-center md:h-8">
                            <input type="checkbox" aria-label={`Select trade #${t.id}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className={checkbox} />
                          </label>
                        </td>
                        <td className="px-2 py-1">
                          <button type="button" className="font-medium hover:underline" onClick={() => openTrade(t.id)}>{t.symbol}</button>
                          <span className="ml-2 md:hidden"><SideBadge side={t.side} /></span>
                          <span className="ml-2 lg:hidden"><SourceBadge source={t.source} /></span>
                          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 sm:hidden">
                            <span className="num text-[12.5px] whitespace-nowrap text-muted">{dateTime(t.openedAt)}</span>
                            <StatusBadge status={t.status} />
                          </span>
                        </td>
                        <td className="hidden px-2 py-1 md:table-cell"><SideBadge side={t.side} /></td>
                        <td className="num hidden px-2 py-1 text-[12.5px] whitespace-nowrap text-ink-soft sm:table-cell">{dateTime(t.openedAt)}</td>
                        <td className="num hidden px-2 py-1 text-[12.5px] whitespace-nowrap text-ink-soft xl:table-cell">{dateTime(t.closedAt)}</td>
                        <td className="hidden max-w-32 truncate px-2 py-1 text-[13px] text-ink-soft xl:table-cell">{t.strategy || <span className="text-muted">None</span>}</td>
                        <td className="hidden px-2 py-1 lg:table-cell"><SourceBadge source={t.source} /></td>
                        <td className="hidden px-2 py-1 md:table-cell"><StatusBadge status={t.status} /></td>
                        <td className="num hidden px-2 py-1 text-right text-[12.5px] text-ink-soft lg:table-cell">{t.quantity}</td>
                        <td className={`num px-2 py-1 text-right whitespace-nowrap ${toneOf(t.pnl)}`}>
                          {t.pnlStatus !== "ok" ? <PnlIssue status={t.pnlStatus} /> : t.pnl === null ? <span className="font-sans text-muted">Open</span> : money(t.pnl, curOf(t), true)}
                          <span className="block text-[12.5px] text-ink-soft sm:hidden">{rFmt(t.rMultiple)}</span>
                        </td>
                        <td className="num hidden px-2 py-1 text-right text-[12.5px] text-ink-soft sm:table-cell">{rFmt(t.rMultiple)}</td>
                        <td className={cx("hidden py-0 text-right whitespace-nowrap opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 md:table-cell [@media(hover:none)]:opacity-100", here && "opacity-100")}>
                          <RowAction label={`View trade #${t.id}`} d="M2 12l5-6h10l5 6-5 6H7zM12 15a3 3 0 100-6 3 3 0 000 6z" onClick={() => openTrade(t.id)} />
                          <RowAction label={`Edit trade #${t.id}`} d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" onClick={() => editTrade(t.id)} />
                          <RowAction label={`Duplicate trade #${t.id}`} d="M9 9h11v11H9zM5 15H4V4h11v1" onClick={() => void duplicateTrade(t.id)} />
                          <RowAction label={`Delete trade #${t.id}`} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" danger onClick={() => void deleteTrades([t.id])} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 text-[13px] text-muted">
                <span><span className="num">{((page - 1) * Number(pageSize) + 1).toLocaleString()} to {Math.min(page * Number(pageSize), total).toLocaleString()} of {total.toLocaleString()}</span>. Times are local time.</span>
                <span className="flex items-center gap-2">
                  <label htmlFor="page-size" className="whitespace-nowrap">Per page</label>
                  <select id="page-size" className="num h-8 border border-line-strong bg-sunken px-1 text-[13px] text-ink max-sm:h-11" value={pageSize} onChange={(e) => set({ pageSize: e.target.value })}>
                    {PAGE_SIZES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  <Button size="sm" className="max-sm:h-11" disabled={page <= 1} onClick={() => set({ page: page > 2 ? String(page - 1) : null })}>Previous</Button>
                  <Button size="sm" className="max-sm:h-11" disabled={page >= lastPage} onClick={() => set({ page: String(page + 1) })}>Next</Button>
                </span>
              </div>
              <p className="hidden text-[12.5px] text-muted md:block">
                <kbd>j</kbd> <kbd>k</kbd> move, <kbd>Enter</kbd> opens, <kbd>x</kbd> selects, <kbd>/</kbd> searches, <kbd>n</kbd> logs a trade.
              </p>
            </div>
          )}

          {selected.size > 0 && (
            <div className="sticky bottom-0 z-10 mt-2 flex flex-wrap items-center gap-3 border-t border-line-strong bg-raised px-3 py-2 text-[13.5px]" role="region" aria-label="Bulk actions">
              <span><span className="num">{selected.size}</span> selected</span>
              <Button size="sm" variant="danger" className="max-sm:h-11" disabled={selected.size > MAX_BULK} title={selected.size > MAX_BULK ? `Up to ${MAX_BULK} at a time` : undefined} onClick={async () => { await deleteTrades([...selected]); setSelected(new Set()); }}>Delete selected</Button>
              <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => setSelected(new Set())}>Clear selection</Button>
            </div>
          )}
        </>
      )}

      <ImportDialog open={get("import") === "1"} onClose={() => set({ import: null })} />
    </>
  );
}
