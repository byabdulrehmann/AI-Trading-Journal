"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money } from "@/lib/client/format";
import type { Trade } from "@/lib/domain/types";
import { Button, Card, EmptyState, cx } from "../ui";
import { SourceBadge } from "./badges";

export interface DuplicatePair {
  a: Trade;
  b: Trade;
  reason: string;
}

/** Each pair is only a suggestion. Nothing changes until the user picks. */
export function Duplicates({ pairs }: { pairs: DuplicatePair[] }) {
  if (pairs.length === 0) return <EmptyState title="No possible duplicates" body="When the same trade arrives from two sources, such as a CSV and MT5, the pair shows up here for you to review." />;
  return (
    <div className="space-y-section">
      {pairs.map((p) => <PairCard key={`${p.a.id}-${p.b.id}`} pair={p} />)}
    </div>
  );
}

function PairCard({ pair: { a, b, reason } }: { pair: DuplicatePair }) {
  const { accounts, refresh, toast, openTrade } = useApp();
  // Broker records hold the fills and ids, so they are the natural one to keep.
  const [keep, setKeep] = useState(b.source === "mt5" && a.source !== "mt5" ? b.id : a.id);
  const [busy, setBusy] = useState(false);
  const cur = accounts.find((x) => x.id === a.accountId)?.currency;
  const rows: [string, (t: Trade) => string | number][] = [
    ["Size", (t) => t.quantity],
    ["Entry", (t) => t.entryPrice],
    ["Exit", (t) => t.exitPrice ?? "—"],
    ["Opened", (t) => dateTime(t.openedAt)],
    ["Closed", (t) => dateTime(t.closedAt)],
    ["Stop", (t) => t.stopPrice ?? "—"],
    ["Target", (t) => t.targetPrice ?? "—"],
    ["Costs", (t) => money(t.commission + t.swap + t.otherFees, cur)],
    ["Net P&L", (t) => money(t.pnl, cur, true)],
    ["Strategy", (t) => t.strategy || "—"],
    ["Notes", (t) => (t.notes ? `${t.notes.length} characters` : "—")],
    ["Attachments", (t) => t.attachments?.length ?? 0],
  ];

  const decide = async (decision: "kept_both" | "merged") => {
    setBusy(true);
    try {
      await api("/api/reconcile", { method: "POST", json: { keepId: keep, otherId: keep === a.id ? b.id : a.id, decision } });
      await refresh();
      toast({ message: decision === "merged" ? `Merged into trade #${keep}.` : "Kept both. This pair won't be raised again.", tone: "success" });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't save that.", tone: "error" });
      setBusy(false);
    }
  };

  return (
    <Card>
      <p className="py-2.5 text-[14px] text-ink">{reason}</p>
      <table className="w-full table-fixed text-[13px]">
        <thead>
          <tr className="border-y border-line text-left">
            <td className="w-[26%] sm:w-40" />
            {[a, b].map((t) => (
              <th key={t.id} scope="col" className={cx("px-2 py-1 font-normal", keep === t.id && "shadow-[inset_0_-2px_0_var(--accent)]")}>
                <label className="flex min-h-11 flex-wrap items-center gap-x-2 sm:min-h-8">
                  <input type="radio" name={`keep-${a.id}-${b.id}`} className="size-3.5 appearance-none border border-line-strong bg-sunken checked:border-accent checked:bg-accent" checked={keep === t.id} onChange={() => setKeep(t.id)} aria-label={`Keep trade ${t.id}`} />
                  <button type="button" className="num font-medium underline-offset-2 hover:underline" onClick={() => openTrade(t.id)}>#{t.id}</button>
                  <SourceBadge source={t.source} />
                </label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => {
            const differs = get(a) !== get(b);
            return (
              <tr key={label} className="border-b border-line">
                <th scope="row" className="py-1.5 pr-2 text-left align-baseline font-normal text-muted">
                  {label}
                  {differs && <span className="ml-1.5 text-warn" title="These two differ">≠<span className="sr-only"> differs</span></span>}
                </th>
                <td className={cx("num px-2 py-1.5 align-baseline break-words", differs ? "text-warn" : "text-ink-soft")}>{get(a)}</td>
                <td className={cx("num px-2 py-1.5 align-baseline break-words", differs ? "text-warn" : "text-ink-soft")}>{get(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <p className="min-w-0 flex-1 basis-64 text-[12.5px] text-muted">Merge keeps the selected trade&apos;s numbers, copies notes, tags and files it lacks from the other, and deletes the other. Differences are marked. Times are local time.</p>
        <div className="flex gap-2">
          <Button size="sm" className="max-sm:h-11" disabled={busy} onClick={() => void decide("kept_both")}>Keep both</Button>
          <Button size="sm" className="max-sm:h-11" variant="primary" disabled={busy} onClick={() => void decide("merged")}>Merge into #{keep}</Button>
        </div>
      </div>
    </Card>
  );
}
