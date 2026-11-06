"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import type { Facets } from "@/lib/client/analytics";
import { useFetch } from "@/lib/client/use-fetch";
import { Button, cx, inputClass } from "@/components/ui";

const ACTIONS = [
  ["setStrategy", "Set strategy"],
  ["clearStrategy", "Clear strategy"],
  ["addTag", "Add a tag"],
  ["removeTag", "Remove a tag"],
  ["moveAccount", "Move to account"],
] as const;
type ActionType = (typeof ACTIONS)[number][0];

const control = "h-8 border border-line-strong bg-sunken px-2 text-[13px] text-ink max-sm:h-11";

/** What can be done to the ticked trades. Trades that can't take a change are counted in the message, never changed quietly. */
export function BulkBar({ ids, maxBulk, onDone, onDelete, onClear }: { ids: number[]; maxBulk: number; onDone: () => void; onDelete: () => void; onClear: () => void }) {
  const { accounts, refresh, toast } = useApp();
  const { data: facets } = useFetch<Facets>("/api/facets");
  const [type, setType] = useState<ActionType>("setStrategy");
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const tooMany = ids.length > maxBulk;
  const needsName = type === "setStrategy" || type === "addTag" || type === "removeTag";
  const list = type === "setStrategy" ? facets?.strategies : [...new Set((facets?.tags ?? []).map((t) => t.name))];
  const ready = !tooMany && !busy && (needsName ? name.trim() !== "" : type === "moveAccount" ? accountId !== "" : true);

  const apply = async () => {
    setBusy(true);
    try {
      const action = needsName ? { type, name } : type === "moveAccount" ? { type, accountId: Number(accountId) } : { type };
      const res = await api<{ changed: number; skipped: { reason: string; count: number }[] }>("/api/trades/bulk", { method: "POST", json: { ids, action } });
      const skipped = res.skipped.map((s) => `${s.count} skipped: ${s.reason}.`).join(" ");
      toast({ message: `Updated ${res.changed} ${res.changed === 1 ? "trade" : "trades"}.${skipped ? ` ${skipped}` : ""}`, tone: res.skipped.length ? "info" : "success" });
      setName("");
      await refresh();
      onDone();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't update those trades.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sticky bottom-0 z-10 mt-2 flex flex-wrap items-center gap-2 border-t border-line-strong bg-raised px-3 py-2 text-[13.5px]" role="region" aria-label="Bulk actions">
      <span className="mr-1"><span className="num">{ids.length}</span> selected</span>
      <select aria-label="Bulk action" className={control} value={type} onChange={(e) => { setType(e.target.value as ActionType); setName(""); }}>
        {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {needsName && (
        <>
          <input aria-label={type === "setStrategy" ? "Strategy name" : "Tag name"} list="bulk-names" maxLength={type === "setStrategy" ? 60 : 30} className={cx(inputClass, "h-8 w-44! text-[13px] max-sm:h-11")} value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="bulk-names">{list?.map((n) => <option key={n} value={n} />)}</datalist>
        </>
      )}
      {type === "moveAccount" && (
        <select aria-label="Move to" className={control} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Choose an account</option>
          {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
      <Button size="sm" className="max-sm:h-11" disabled={!ready} onClick={() => void apply()}>Apply</Button>
      <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" aria-hidden />
      <a href={`/api/trades/export?ids=${ids.join(",")}`} download className={cx("inline-flex h-8 items-center border border-line-strong px-3 text-[13px] font-medium hover:bg-canvas max-sm:h-11", tooMany && "pointer-events-none opacity-55")} aria-disabled={tooMany}>Export selected</a>
      <Button size="sm" variant="danger" className="max-sm:h-11" disabled={tooMany} title={tooMany ? `Up to ${maxBulk} at a time` : undefined} onClick={onDelete}>Delete selected</Button>
      <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={onClear}>Clear selection</Button>
    </div>
  );
}
