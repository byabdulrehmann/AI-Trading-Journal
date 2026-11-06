"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { useFetch } from "@/lib/client/use-fetch";
import type { RuleGroup } from "@/lib/domain/playbooks";
import { RULE_GROUPS } from "@/lib/domain/playbooks";
import { Button } from "@/components/ui";

interface Checklist {
  strategyId: number | null;
  strategy: string | null;
  reviewed: boolean;
  rules: { id: number; group: RuleGroup; text: string; checked: boolean }[];
}

const box = "size-3.5 shrink-0 appearance-none border border-line-strong bg-sunken align-middle checked:border-accent checked:bg-accent";

/** A trade against its playbook's rules. Each tick saves, and synced trades can be reviewed like any other. */
export function PlaybookChecklist({ tradeId }: { tradeId: number }) {
  const { toast } = useApp();
  const { data } = useFetch<Checklist>(`/api/trades/${tradeId}/rules`);
  // The latest answers until a fresh fetch replaces them, such as after the trade moved to another playbook.
  const [saved, setSaved] = useState<{ base: Checklist | undefined; list: Checklist } | null>(null);
  const list = saved && saved.base === data ? saved.list : data;
  const setList = (next: Checklist) => setSaved({ base: data, list: next });

  if (!list || list.strategyId === null) return null;

  const save = async (checked: number[] | null) => {
    const previous = list;
    setList({ ...list, reviewed: checked !== null, rules: list.rules.map((r) => ({ ...r, checked: checked?.includes(r.id) ?? false })) });
    try {
      setList(await api<Checklist>(`/api/trades/${tradeId}/rules`, { method: "PUT", json: { checked } }));
    } catch (e) {
      setList(previous);
      toast({ message: e instanceof Error ? e.message : "Couldn't save the checklist.", tone: "error" });
    }
  };
  const on = list.rules.filter((r) => r.checked).map((r) => r.id);

  return (
    <section className="border-t border-line pt-4" aria-label="Playbook checklist" data-testid="checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">{list.strategy} rules</h3>
        {list.rules.length > 0 && <span className="text-[12.5px] text-muted">{list.reviewed ? <><span className="num">{on.length} of {list.rules.length}</span> followed</> : "Not reviewed yet"}</span>}
      </div>
      {list.rules.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted">
          This playbook has no rules yet. <Link href={`/playbooks?playbook=${list.strategyId}`} className="text-ink-soft underline underline-offset-2 hover:text-ink">Add some</Link> to check trades against them.
        </p>
      ) : (
        <>
          {RULE_GROUPS.map((group) => {
            const rules = list.rules.filter((r) => r.group === group);
            return rules.length === 0 ? null : (
              <fieldset key={group} className="mt-2">
                <legend className="text-[12.5px] text-muted">{group}</legend>
                {rules.map((r) => (
                  <label key={r.id} className="flex min-h-8 items-center gap-2 text-[13.5px] text-ink-soft max-sm:min-h-11">
                    <input type="checkbox" className={box} checked={r.checked} onChange={(e) => void save(e.target.checked ? [...on, r.id] : on.filter((id) => id !== r.id))} />
                    {r.text}
                  </label>
                ))}
              </fieldset>
            );
          })}
          <div className="mt-2 flex flex-wrap gap-2">
            {!list.reviewed && <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => void save([])}>None were followed</Button>}
            {list.reviewed && <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => void save(null)}>Clear my answers</Button>}
          </div>
        </>
      )}
    </section>
  );
}
