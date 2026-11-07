"use client";

import { useMemo } from "react";
import type { Analytics, Facets } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { dayWindow } from "@/lib/client/calendar";
import type { UrlFilters } from "@/lib/client/filters";
import { SESSION_LABELS, displayZone, duration, money, pct, rFmt } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { ASSET_CLASSES } from "@/lib/domain/engine/instruments";
import { compareMetrics, type CompareRow } from "@/lib/domain/metrics";
import { EMOTIONS, GRADES, MISTAKES } from "@/lib/domain/types";
import { zoneInstant, zoneParts } from "@/lib/domain/zone";
import { LineChart } from "@/components/charts";
import { Button, Card, CardHeader, EmptyState, Notice, Spinner, cx } from "@/components/ui";

const nice = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t[0].toUpperCase() + t.slice(1);
};
/** What a group can narrow by. Dates are days, turned into instants on the way out. */
const KEYS = ["from", "to", "accountId", "symbol", "strategy", "side", "session", "assetClass", "tag", "mistake", "emotion", "grade", "plan"] as const;
type Key = (typeof KEYS)[number];
type Group = Partial<Record<Key, string>>;

const dayKey = (y: number, m: number, d: number) => {
  const p = zoneParts(zoneInstant(y, m, d, 12, 0, displayZone()), displayZone());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

function presets(): { label: string; a: Group; b: Group }[] {
  const t = zoneParts(Date.now(), displayZone());
  return [
    { label: "Long against short", a: { side: "long" }, b: { side: "short" } },
    { label: "On plan against off plan", a: { plan: "on" }, b: { plan: "off" } },
    { label: "This month against last", a: { from: dayKey(t.year, t.month, 1), to: dayKey(t.year, t.month + 1, 0) }, b: { from: dayKey(t.year, t.month - 1, 1), to: dayKey(t.year, t.month, 0) } },
    { label: "London against New York", a: { session: "london" }, b: { session: "new_york" } },
  ];
}

const groupQuery = (g: Group): Record<string, string> => {
  const { from, to, ...rest } = g;
  const out: Record<string, string> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v));
  if (from) out.from = dayWindow(from).start;
  if (to) out.to = dayWindow(to).end;
  return out;
};

const control = "h-8 min-w-0 w-full border-b border-line bg-transparent px-1 text-[13px] text-ink-soft max-sm:h-11";

function GroupEditor({ name, group, onChange, accounts, facets }: { name: string; group: Group; onChange: (k: Key, v: string) => void; accounts: { id: number; name: string }[]; facets: Facets | undefined }) {
  const tagNames = [...new Set((facets?.tags ?? []).map((t) => t.name))];
  const select = (key: Key, label: string, options: string[][]) => (
    <select aria-label={`${name}: ${label}`} className={cx(control, group[key] && "text-ink shadow-[inset_0_-2px_0_var(--accent)]")} value={group[key] ?? ""} onChange={(e) => onChange(key, e.target.value)}>
      <option value="">{label}: any</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <fieldset className="min-w-0 border-t border-line pt-2" data-testid={`group-${name}`}>
      <legend className="text-[14px] font-medium text-ink">{name}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <label className="flex flex-col text-[12px] text-muted">From<input type="date" aria-label={`${name}: from`} className={cx(control, "num")} value={group.from ?? ""} max={group.to || undefined} onChange={(e) => onChange("from", e.target.value)} /></label>
        <label className="flex flex-col text-[12px] text-muted">To<input type="date" aria-label={`${name}: to`} className={cx(control, "num")} value={group.to ?? ""} min={group.from || undefined} onChange={(e) => onChange("to", e.target.value)} /></label>
        {select("accountId", "Account", accounts.map((a) => [String(a.id), a.name]))}
        {select("symbol", "Instrument", (facets?.symbols ?? []).map((s) => [s, s]))}
        {select("strategy", "Strategy", (facets?.strategies ?? []).map((s) => [s, s]))}
        {select("side", "Direction", [["long", "Long"], ["short", "Short"]])}
        {select("session", "Session", Object.entries(SESSION_LABELS))}
        {select("assetClass", "Asset class", ASSET_CLASSES.map((c) => [c, nice(c)]))}
        {select("tag", "Tag", tagNames.map((t) => [t, t]))}
        {select("mistake", "Mistake", MISTAKES.map((x) => [x, nice(x)]))}
        {select("emotion", "Emotion", EMOTIONS.map((x) => [x, nice(x)]))}
        {select("grade", "Grade", GRADES.map((x) => [x, x]))}
        {select("plan", "Plan", [["on", "On plan"], ["off", "Off plan"], ["unanswered", "Not answered"]])}
      </div>
    </fieldset>
  );
}

function text(row: CompareRow, v: number | null, unit: string): string {
  if (v === null) return "—";
  if (row.kind === "money") return money(v, unit);
  if (row.kind === "percent") return pct(v, 1);
  if (row.kind === "r") return rFmt(v);
  if (row.kind === "minutes") return duration(v);
  if (row.kind === "count") return String(v);
  return v.toFixed(2);
}

function diffText(row: CompareRow, unit: string): string {
  if (row.diff === null) return "—";
  const sign = row.diff > 0 ? "+" : row.diff < 0 ? "−" : "";
  const abs = Math.abs(row.diff);
  if (row.kind === "money") return `${sign}${money(abs, unit)}`;
  if (row.kind === "percent") return `${sign}${(abs * 100).toFixed(1)} pts`;
  if (row.kind === "r") return `${sign}${abs.toFixed(2)}R`;
  if (row.kind === "minutes") return `${sign}${duration(abs)}`;
  if (row.kind === "count") return `${sign}${abs}`;
  return `${sign}${abs.toFixed(2)}`;
}

/** Two groups of trades, side by side, on top of whatever the filter bar already narrows. Lives in the URL, so a comparison can be reopened. */
export function CompareReport({ filters, currency }: { filters: UrlFilters; currency: string }) {
  const { accounts } = useApp();
  const { data: facets } = useFetch<Facets>("/api/facets");
  const read = (prefix: string): Group => Object.fromEntries(KEYS.flatMap((k) => (filters.get(`${prefix}.${k}`) ? [[k, filters.get(`${prefix}.${k}`)]] : [])));
  const a = read("a");
  const b = read("b");
  const empty = Object.keys(a).length === 0 && Object.keys(b).length === 0;

  const queryOf = (g: Group) => filters.apiQuery({ extra: { currency, ...groupQuery(g) } });
  const left = useFetch<Analytics>(`/api/analytics?${queryOf(a)}`);
  const right = useFetch<Analytics>(`/api/analytics?${queryOf(b)}`);

  const clear = Object.fromEntries(["a", "b"].flatMap((p) => KEYS.map((k) => [`${p}.${k}`, null as string | null])));
  const apply = (nextA: Group, nextB: Group) => filters.set({ ...clear, ...Object.fromEntries(Object.entries(nextA).map(([k, v]) => [`a.${k}`, v as string])), ...Object.fromEntries(Object.entries(nextB).map(([k, v]) => [`b.${k}`, v as string])) });

  const rows = useMemo(() => (left.data && right.data ? compareMetrics(left.data.metrics, right.data.metrics) : []), [left.data, right.data]);
  const lists = useMemo(() => presets(), []);

  const l = left.data;
  const r = right.data;
  const sameUnit = l && r && l.display === r.display;
  const domain: [number, number] | undefined = l && r ? [Math.min(0, ...l.equity.map((p) => p.equity), ...r.equity.map((p) => p.equity)), Math.max(0, ...l.equity.map((p) => p.equity), ...r.equity.map((p) => p.equity))] : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ready-made comparisons">
        {lists.map((p) => <Button key={p.label} size="sm" className="max-sm:h-11" onClick={() => apply(p.a, p.b)}>{p.label}</Button>)}
        {!empty && <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => filters.set(clear)}>Clear groups</Button>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 lg:grid-cols-2">
        <GroupEditor name="Group A" group={a} onChange={(k, v) => filters.set({ [`a.${k}`]: v })} accounts={accounts} facets={facets} />
        <GroupEditor name="Group B" group={b} onChange={(k, v) => filters.set({ [`b.${k}`]: v })} accounts={accounts} facets={facets} />
      </div>

      {left.error || right.error ? (
        <EmptyState title="Couldn't compare those" body={left.error ?? right.error} action={<Button onClick={() => { left.reload(); right.reload(); }}>Try again</Button>} />
      ) : !l || !r ? (
        <Spinner label="Working out both groups" />
      ) : !sameUnit ? (
        <Notice tone="warn">These groups report in different currencies ({l.display} and {r.display}), so their money can&apos;t be compared. Pick accounts in one currency.</Notice>
      ) : (
        <>
          {empty && <p className="text-[13.5px] text-muted">Both groups are the same until you narrow one. Start with a ready-made comparison, or set a group&apos;s filters above.</p>}
          <Card>
            <CardHeader title="Side by side" subtitle="The difference is A minus B." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-[13.5px]" data-testid="compare-table">
                <thead className="text-left text-[12.5px] text-muted">
                  <tr className="border-b border-line">
                    <td className="py-1.5" />
                    <th scope="col" className="py-1.5 pl-3 text-right font-normal">Group A</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-normal">Group B</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-normal">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} data-row={row.key} className="border-b border-line">
                      <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">{row.label}</th>
                      <td className="num py-1.5 pl-3 text-right">{text(row, row.a, row.key === "totalFees" ? currency : l.display)}</td>
                      <td className="num py-1.5 pl-3 text-right">{text(row, row.b, row.key === "totalFees" ? currency : l.display)}</td>
                      <td className="num py-1.5 pl-3 text-right text-ink-soft">{diffText(row, row.key === "totalFees" ? currency : l.display)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Group A equity" subtitle="Both charts share one scale." />
              <LineChart label="Group A equity" points={l.equity.map((p) => ({ at: p.at, value: p.equity }))} currency={l.display} height={180} domain={domain} />
            </Card>
            <Card>
              <CardHeader title="Group B equity" subtitle="Both charts share one scale." />
              <LineChart label="Group B equity" points={r.equity.map((p) => ({ at: p.at, value: p.equity }))} currency={r.display} height={180} domain={domain} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
