"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money, rFmt, toneOf } from "@/lib/client/format";
import type { Trade } from "@/lib/domain/types";
import { ImportDialog } from "@/components/journal/ImportDialog";
import { useTradeActions } from "@/components/journal/useTradeActions";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, cx, inputClass } from "@/components/ui";

type SortKey = "openedAt" | "pnl" | "rMultiple" | "symbol";

function SortHeader({ k, sort, onSort, children, className }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx("px-3 py-2.5 font-medium", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <span aria-hidden className="text-[10px]">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

export default function JournalPage() {
  const { trades, accounts, loading, editTrade, openTrade } = useApp();
  const { deleteTrades } = useTradeActions();
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [plan, setPlan] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "openedAt", dir: -1 });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // "/journal?import=1" from the overview opens the importer.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (new URLSearchParams(window.location.search).get("import") === "1") setImportOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = trades.filter((t) => {
      if (account !== "all" && String(t.accountId) !== account) return false;
      if (outcome === "win" && !(t.pnl !== null && t.pnl > 0)) return false;
      if (outcome === "loss" && !(t.pnl !== null && t.pnl < 0)) return false;
      if (outcome === "open" && t.pnl !== null) return false;
      if (plan === "on" && t.followedPlan !== true) return false;
      if (plan === "off" && t.followedPlan !== false) return false;
      if (plan === "unanswered" && t.followedPlan !== null) return false;
      if (source !== "all" && t.source !== source) return false;
      if (needle && ![t.symbol, t.setup, t.notes, t.planNotes, ...t.tags, `#${t.id}`].some((s) => s.toLowerCase().includes(needle))) return false;
      return true;
    });
    const val = (t: Trade) => (sort.key === "openedAt" ? Date.parse(t.openedAt) : sort.key === "symbol" ? t.symbol : (t[sort.key] ?? -Infinity));
    return out.sort((a, b) => (val(a) > val(b) ? sort.dir : val(a) < val(b) ? -sort.dir : 0));
  }, [trades, q, account, outcome, plan, source, sort]);

  const visibleIds = filtered.map((t) => t.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
  const curOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency ?? "USD";
  const anyFilter = q || account !== "all" || outcome !== "all" || plan !== "all" || source !== "all";

  const sh = { sort, onSort: sortBy };

  return (
    <>
      <PageHeader
        title="Journal"
        description="Every trade you've logged or imported. Click a row to review it."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Import CSV</Button>
            <Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button>
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <div className="col-span-2">
            <label htmlFor="journal-search" className="sr-only">Search trades</label>
            <input id="journal-search" type="search" className={inputClass} placeholder="Search symbol, setup, notes, tags, #id" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {[
            { label: "Account", value: account, set: setAccount, options: [["all", "All accounts"], ...accounts.map((a) => [String(a.id), a.name + (a.archived ? " (archived)" : "")])] },
            { label: "Outcome", value: outcome, set: setOutcome, options: [["all", "Any outcome"], ["win", "Winners"], ["loss", "Losers"], ["open", "Open"]] },
            { label: "Plan", value: plan, set: setPlan, options: [["all", "Any plan answer"], ["on", "On plan"], ["off", "Off plan"], ["unanswered", "Not answered"]] },
            { label: "Source", value: source, set: setSource, options: [["all", "Any source"], ["manual", "Logged"], ["csv", "Imported"], ["sample", "Sample"]] },
          ].map((f) => (
            <select key={f.label} aria-label={f.label} className={inputClass} value={f.value} onChange={(e) => f.set(e.target.value)}>
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
        </div>
      </Card>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-line-strong bg-raised px-4 py-2 text-[14px]" role="region" aria-label="Bulk actions">
          <span>{selected.size} selected</span>
          <Button size="sm" variant="danger" onClick={async () => { await deleteTrades([...selected]); setSelected(new Set()); }}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : trades.length === 0 ? (
        <EmptyState title="Your journal is empty" body="Log a trade by hand or import a CSV export from your platform." action={<><Button onClick={() => setImportOpen(true)}>Import CSV</Button><Button variant="primary" onClick={() => editTrade("new")}>Log trade</Button></>} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No trades match" body="Try a different search or clear the filters." action={anyFilter && <Button onClick={() => { setQ(""); setAccount("all"); setOutcome("all"); setPlan("all"); setSource("all"); }}>Clear filters</Button>} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <caption className="sr-only">Trades, {filtered.length} shown</caption>
              <thead className="border-b border-line text-left text-[13px] text-muted">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <input type="checkbox" aria-label="Select all shown trades" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visibleIds))} className="accent-[var(--accent)]" />
                  </th>
                  <SortHeader {...sh} k="openedAt" className="hidden sm:table-cell">Opened</SortHeader>
                  <SortHeader {...sh} k="symbol">Symbol</SortHeader>
                  <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell">Setup</th>
                  <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">Review</th>
                  <SortHeader {...sh} k="pnl" className="text-right">P&L</SortHeader>
                  <SortHeader {...sh} k="rMultiple" className="hidden text-right sm:table-cell">R</SortHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((t) => (
                  <tr key={t.id} className={cx("cursor-pointer hover:bg-raised/50", selected.has(t.id) && "bg-accent-soft")} onClick={() => openTrade(t.id)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select trade #${t.id}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="accent-[var(--accent)]" />
                    </td>
                    <td className="num hidden px-3 py-2.5 text-[13px] whitespace-nowrap text-ink-soft sm:table-cell">{dateTime(t.openedAt)}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" className="flex items-center gap-2 text-left font-medium hover:text-accent" onClick={(e) => { e.stopPropagation(); openTrade(t.id); }}>
                        {t.symbol}
                        <Badge tone={t.side === "long" ? "info" : "accent"}>{t.side}</Badge>
                        {t.source === "sample" && <Badge tone="info" className="hidden sm:inline-flex">Sample</Badge>}
                      </button>
                      <span className="num block text-[12px] text-muted sm:hidden">{dateTime(t.openedAt)}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-ink-soft md:table-cell">{t.setup || <span className="text-muted">—</span>}</td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      <span className="flex gap-1">
                        {t.grade && <Badge>{t.grade}</Badge>}
                        {t.followedPlan !== null && <Badge tone={t.followedPlan ? "profit" : "loss"}>{t.followedPlan ? "on plan" : "off plan"}</Badge>}
                        {t.emotionBefore && <Badge>{t.emotionBefore}</Badge>}
                      </span>
                    </td>
                    <td className={`num px-3 py-2.5 text-right whitespace-nowrap ${toneOf(t.pnl)}`}>{t.pnl === null ? <Badge tone="accent">Open</Badge> : money(t.pnl, curOf(t), true)}</td>
                    <td className="num hidden px-3 py-2.5 text-right text-ink-soft sm:table-cell">{rFmt(t.rMultiple)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">
            {filtered.length} of {trades.length} trades
          </p>
        </Card>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
