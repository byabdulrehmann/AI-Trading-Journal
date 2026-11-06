"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { useUrlFilters } from "@/lib/client/filters";
import { dateOnly, fromLocalInput, money, pct, rFmt, toLocalInput, toneOf } from "@/lib/client/format";
import { journalHref } from "@/lib/client/journal-links";
import { useFetch } from "@/lib/client/use-fetch";
import { METRIC_DEFINITIONS as D, type MissedSummary, type PlaybookStats } from "@/lib/domain/metrics";
import { PLAYBOOK_TEMPLATES, RULE_GROUPS, type MissedTrade, type PlaybookRule, type RuleGroup } from "@/lib/domain/playbooks";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { Suspended } from "@/components/Suspended";
import { TradeFilters } from "@/components/TradeFilters";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Metric, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

interface Playbook {
  id: number;
  name: string;
  description: string;
  isSample: boolean;
  rules: PlaybookRule[];
  stats: PlaybookStats;
  missed: MissedSummary;
}
interface Response {
  currency: string;
  currencies: string[];
  playbooks: Playbook[];
  unassigned: PlaybookStats;
}

export default function PlaybooksPage() {
  return (
    <Suspended>
      <Playbooks />
    </Suspended>
  );
}

const pfText = (s: PlaybookStats) => (s.profitFactor !== null ? s.profitFactor.toFixed(2) : s.losses === 0 && s.wins > 0 ? "No losses" : "—");
const head = "py-1.5 pr-3 text-right font-normal whitespace-nowrap";
const cell = "num py-1.5 pr-3 text-right whitespace-nowrap";

function Playbooks() {
  const filters = useUrlFilters();
  const search = useSearchParams();
  const router = useRouter();
  const { toast } = useApp();
  const { data, error, reload } = useFetch<Response>(`/api/playbooks?${filters.apiQuery()}`);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const open = Number(search.get("playbook")) || null;

  const hrefFor = (id: number | null) => {
    const next = new URLSearchParams(search.toString());
    if (id) next.set("playbook", String(id));
    else next.delete("playbook");
    const qs = next.toString();
    return qs ? `/playbooks?${qs}` : "/playbooks";
  };

  const create = async (input: { name: string; description?: string; rules?: { group: RuleGroup; text: string }[] }) => {
    try {
      const res = await api<{ playbook: { id: number } }>("/api/playbooks", { method: "POST", json: input });
      setName("");
      setNameError(undefined);
      reload();
      router.push(hrefFor(res.playbook.id), { scroll: false });
    } catch (e) {
      const issue = fieldErrors(e).name;
      if (issue) setNameError(issue);
      else toast({ message: e instanceof Error ? e.message : "Couldn't create the playbook.", tone: "error" });
    }
  };

  if (error && !data) return <EmptyState title="Couldn't load your playbooks" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading your playbooks" />;

  const cur = data.currency;
  const selected = data.playbooks.find((p) => p.id === open);
  const taken = new Set(data.playbooks.map((p) => p.name.toLowerCase()));
  const templates = PLAYBOOK_TEMPLATES.filter((t) => !taken.has(t.name.toLowerCase()));
  const sorted = [...data.playbooks].sort((a, b) => b.stats.netPnl - a.stats.netPnl);

  return (
    <div>
      <PageHeader title="Playbooks" description="Write down what each setup requires, check trades against it, and compare what following it is worth." actions={<CurrencyPicker currency={data.currency} currencies={data.currencies} filters={filters} />} />
      <TradeFilters filters={filters} />

      {selected ? (
        <PlaybookDetail key={selected.id} playbook={selected} currency={cur} backHref={hrefFor(null)} journalLink={journalHref(search.toString(), { strategy: selected.name })} onChanged={reload} onDeleted={() => { reload(); router.push(hrefFor(null), { scroll: false }); }} />
      ) : (
        <>
          <form
            className="mb-5 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void create({ name });
            }}
          >
            <Field label="New playbook" error={nameError}>
              {(p) => <input {...p} className={cx(inputClass, "w-64!")} maxLength={60} placeholder="Name it after the setup" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" disabled={!name.trim()} className="max-sm:h-11">Create</Button>
            {templates.length > 0 && (
              <label className="flex flex-col gap-1 text-[13px] text-ink-soft">
                Or start from a template
                <select
                  aria-label="Start from a template"
                  className="h-9 border border-line-strong bg-transparent px-2 text-[13.5px] text-ink max-sm:h-11"
                  value=""
                  onChange={(e) => {
                    const t = templates.find((x) => x.name === e.target.value);
                    if (t) void create(t);
                  }}
                >
                  <option value="">Choose a template</option>
                  {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              </label>
            )}
          </form>

          {sorted.length === 0 ? (
            <EmptyState title="No playbooks yet" body="A playbook is a setup and the rules that make it valid. Create one, or start from a template and change it to fit how you trade." />
          ) : (
            <Card>
              <CardHeader title="Side by side" subtitle="Figures for the filters above, in closed trades. A playbook opens its rules." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-[13.5px]" data-testid="playbook-table">
                  <thead className="text-left text-[12.5px] text-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-1.5 pr-3 font-normal">Playbook</th>
                      <th scope="col" className={head}>Rules</th>
                      <th scope="col" className={head}>Trades</th>
                      <th scope="col" className={head}>Win rate</th>
                      <th scope="col" className={head}>Profit factor</th>
                      <th scope="col" className={head}>Expectancy</th>
                      <th scope="col" className={head}>Avg R</th>
                      <th scope="col" className={head}>Adherence</th>
                      <th scope="col" className={head}>Missed</th>
                      <th scope="col" className="py-1.5 text-right font-normal whitespace-nowrap">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((p) => (
                      <tr key={p.id} data-playbook={p.name} className="border-b border-line hover:bg-raised">
                        <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                          <Link href={hrefFor(p.id)} scroll={false} className="font-medium underline-offset-2 hover:underline">{p.name}</Link>
                          {p.isSample && <Badge tone="info" className="ml-2">Sample</Badge>}
                        </th>
                        <td className={cell}>{p.rules.length}</td>
                        <td className={cell}>{p.stats.closed}</td>
                        <td className={cell}>{pct(p.stats.winRate)}</td>
                        <td className={cell}>{pfText(p.stats)}</td>
                        <td className={cx(cell, toneOf(p.stats.expectancy))}>{money(p.stats.expectancy, cur, true)}</td>
                        <td className={cx(cell, toneOf(p.stats.avgR))}>{rFmt(p.stats.avgR)}</td>
                        <td className={cell}>{p.stats.adherence === null ? <span className="font-sans text-muted">Not reviewed</span> : pct(p.stats.adherence)}</td>
                        <td className={cell}>{p.missed.count || "—"}</td>
                        <td className={cx("num py-1.5 text-right whitespace-nowrap", toneOf(p.stats.netPnl))}>{money(p.stats.netPnl, cur, true)}</td>
                      </tr>
                    ))}
                    {data.unassigned.closed > 0 && (
                      <tr className="border-b border-line text-ink-soft" data-playbook="">
                        <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">No playbook</th>
                        <td className={cell}>—</td>
                        <td className={cell}>{data.unassigned.closed}</td>
                        <td className={cell}>{pct(data.unassigned.winRate)}</td>
                        <td className={cell}>{pfText(data.unassigned)}</td>
                        <td className={cx(cell, toneOf(data.unassigned.expectancy))}>{money(data.unassigned.expectancy, cur, true)}</td>
                        <td className={cx(cell, toneOf(data.unassigned.avgR))}>{rFmt(data.unassigned.avgR)}</td>
                        <td className={cell}>—</td>
                        <td className={cell}>—</td>
                        <td className={cx("num py-1.5 text-right whitespace-nowrap", toneOf(data.unassigned.netPnl))}>{money(data.unassigned.netPnl, cur, true)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PlaybookDetail({ playbook, currency, backHref, journalLink, onChanged, onDeleted }: { playbook: Playbook; currency: string; backHref: string; journalLink: string; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useApp();
  const s = playbook.stats;

  const patch = async (json: Record<string, unknown>) => {
    await api(`/api/playbooks/${playbook.id}`, { method: "PATCH", json });
    onChanged();
  };
  const saveField = async (json: Record<string, unknown>, restore: () => void) => {
    try {
      await patch(json);
      toast({ message: "Saved.", tone: "success" });
    } catch (e) {
      restore();
      toast({ message: e instanceof Error ? e.message : "Couldn't save.", tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} scroll={false} className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">All playbooks</Link>
        <span className="flex flex-wrap gap-2">
          <Link href={journalLink} className="inline-flex h-8 items-center border border-line-strong px-3 text-[13px] font-medium hover:bg-raised max-sm:h-11">Open its trades</Link>
          <Button
            size="sm"
            variant="danger"
            className="max-sm:h-11"
            onClick={async () => {
              if (!confirm(`Delete the playbook "${playbook.name}"? Its trades stay, with no playbook. Its rules and their answers go.`)) return;
              try {
                await api(`/api/playbooks/${playbook.id}`, { method: "DELETE" });
                onDeleted();
              } catch (e) {
                toast({ message: e instanceof Error ? e.message : "Couldn't delete.", tone: "error" });
              }
            }}
          >
            Delete playbook
          </Button>
        </span>
      </div>

      <div className="grid max-w-3xl gap-3">
        <Field label="Name">
          {(p) => <input {...p} className={cx(inputClass, "text-[16px] font-medium")} maxLength={60} defaultValue={playbook.name} onBlur={(e) => { const el = e.target; if (el.value.trim() && el.value.trim() !== playbook.name) void saveField({ name: el.value }, () => { el.value = playbook.name; }); else el.value = playbook.name; }} />}
        </Field>
        <Field label="What this setup is">
          {(p) => <textarea {...p} rows={2} maxLength={2000} className={cx(inputClass, "h-auto py-1.5")} defaultValue={playbook.description} onBlur={(e) => { const el = e.target; if (el.value !== playbook.description) void saveField({ description: el.value }, () => { el.value = playbook.description; }); }} />}
        </Field>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="How it has done" subtitle="Closed trades, for the filters above." />
          <dl>
            <Metric def={D.closedTrades} value={s.closed} />
            <Metric def={D.netPnl} value={money(s.netPnl, currency, true)} tone={toneOf(s.netPnl)} />
            <Metric def={D.winRate} value={pct(s.winRate, 1)} />
            <Metric def={D.profitFactor} value={pfText(s)} />
            <Metric def={D.expectancy} value={money(s.expectancy, currency, true)} tone={toneOf(s.expectancy)} />
            <Metric def={D.avgR} value={rFmt(s.avgR)} tone={toneOf(s.avgR)} note={s.rSample ? `${s.rSample} trades with a stop` : "Needs trades with a stop"} />
          </dl>
        </Card>
        <Card>
          <CardHeader title="Does following it pay?" subtitle="Only closed trades you've checked against the rules." />
          <dl>
            <Metric def={D.ruleAdherence} value={s.adherence === null ? "Not reviewed" : pct(s.adherence)} note={s.reviewed ? `${s.reviewed} of ${s.closed + s.openReviewed} trades reviewed` : "Tick the rules on a trade, in its detail panel"} />
          </dl>
          <table className="mt-2 w-full text-[13.5px]" data-testid="on-off-rules">
            <thead className="text-left text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <td className="py-1.5" />
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">Trades</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">Won</th>
                <th scope="col" className="py-1.5 text-right font-normal">Net</th>
              </tr>
            </thead>
            <tbody>
              {([["Every rule followed", s.onRule], ["A rule missed", s.offRule]] as const).map(([label, row]) => (
                <tr key={label} className="border-b border-line">
                  <th scope="row" className="py-1.5 text-left font-normal text-ink-soft">{label}</th>
                  <td className="num py-1.5 pr-3 text-right">{row?.trades ?? 0}</td>
                  <td className="num py-1.5 pr-3 text-right">{row ? pct(row.winRate) : "—"}</td>
                  <td className={cx("num py-1.5 text-right", toneOf(row?.netPnl))}>{row ? money(row.netPnl, currency, true) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <RulesEditor playbook={playbook} save={(rules) => patch({ rules })} />
      <MissedTrades playbook={playbook} onChanged={onChanged} />
    </div>
  );
}

function RulesEditor({ playbook, save }: { playbook: Playbook; save: (rules: { id?: number; group: RuleGroup; text: string }[]) => Promise<void> }) {
  const { toast } = useApp();
  const [adding, setAdding] = useState<Record<string, string>>({});
  const rules = playbook.rules;

  const commit = async (next: { id?: number; group: RuleGroup; text: string }[]) => {
    try {
      await save(next);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't save the rules.", tone: "error" });
    }
  };

  return (
    <Card>
      <CardHeader title="Rules" subtitle="These become the checklist on every trade in this playbook. Removing a rule removes its answers." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-5 lg:grid-cols-2" data-testid="rules">
        {RULE_GROUPS.map((group) => (
          <section key={group} aria-label={`${group} rules`}>
            <h3 className="text-[13px] font-medium text-ink">{group}</h3>
            <ul className="mt-1 divide-y divide-line border-y border-line">
              {rules.filter((r) => r.group === group).map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1">
                  <textarea
                    rows={1}
                    aria-label={`Rule: ${r.text}`}
                    className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[13.5px] text-ink-soft [field-sizing:content] hover:text-ink"
                    defaultValue={r.text}
                    maxLength={200}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      if (!text) e.target.value = r.text;
                      else if (text !== r.text) void commit(rules.map((x) => (x.id === r.id ? { ...x, text } : x)));
                    }}
                  />
                  <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Remove rule: ${r.text}`} onClick={() => void commit(rules.filter((x) => x.id !== r.id))}>Remove</Button>
                </li>
              ))}
              {rules.every((r) => r.group !== group) && <li className="py-1.5 text-[13px] text-muted">None yet.</li>}
            </ul>
            <form
              className="mt-1.5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = (adding[group] ?? "").trim();
                if (!text) return;
                setAdding((a) => ({ ...a, [group]: "" }));
                void commit([...rules, { group, text }]);
              }}
            >
              <input aria-label={`New ${group} rule`} className={cx(inputClass, "h-8 text-[13px] max-sm:h-11")} placeholder={`Add a rule to ${group.toLowerCase()}`} maxLength={200} value={adding[group] ?? ""} onChange={(e) => setAdding((a) => ({ ...a, [group]: e.target.value }))} />
              <Button size="sm" type="submit" className="max-sm:h-11" disabled={!(adding[group] ?? "").trim()}>Add</Button>
            </form>
          </section>
        ))}
      </div>
    </Card>
  );
}

function MissedTrades({ playbook, onChanged }: { playbook: Playbook; onChanged: () => void }) {
  const { toast } = useApp();
  const search = useSearchParams();
  const sample = search.get("includeSample") === "1";
  const { data, reload } = useFetch<{ missed: MissedTrade[] }>(`/api/missed${sample ? "?includeSample=1" : ""}`);
  const list = (data?.missed ?? []).filter((m) => m.strategyId === playbook.id);
  const blank = () => ({ symbol: "", side: "long" as "long" | "short", at: toLocalInput(new Date().toISOString()), entry: "", stop: "", exit: "", reason: "" });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const m = playbook.missed;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/missed", { method: "POST", json: { strategyId: playbook.id, symbol: form.symbol, side: form.side, at: fromLocalInput(form.at), entryPrice: num(form.entry), stopPrice: num(form.stop), exitPrice: num(form.exit), reason: form.reason } });
      setForm(blank());
      setErrors({});
      reload();
      onChanged();
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast({ message: err instanceof Error ? err.message : "Couldn't save it.", tone: "error" });
    }
  };

  return (
    <Card>
      <CardHeader
        title="Missed trades"
        subtitle="Setups you saw and didn't take. They never count in your results."
        action={m.count > 0 ? <span className="text-[13px] text-ink-soft" data-testid="missed-summary"><span className="num">{m.count}</span> missed{m.rSample ? <>, <span className={cx("num", toneOf(m.totalR))}>{rFmt(m.totalR)}</span> left behind</> : null}</span> : undefined}
      />
      {list.length > 0 && (
        <ul className="mb-4 divide-y divide-line border-y border-line text-[13.5px]" data-testid="missed-list">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
              <span className="font-medium">{t.symbol}</span>
              <span className="text-ink-soft capitalize">{t.side}</span>
              <span className="num text-[12.5px] text-muted">{dateOnly(t.at)}</span>
              {t.isSample && <Badge tone="info">Sample</Badge>}
              <span className="order-last min-w-0 basis-full text-[13px] text-muted sm:order-none sm:flex-1 sm:basis-0 sm:truncate">{t.reason}</span>
              <span className={cx("num", toneOf(t.r))}>{rFmt(t.r)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="max-sm:h-11"
                aria-label={`Remove missed ${t.symbol}`}
                onClick={async () => {
                  await api(`/api/missed/${t.id}`, { method: "DELETE" }).catch(() => toast({ message: "Couldn't remove it.", tone: "error" }));
                  reload();
                  onChanged();
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7" aria-label="Log a missed trade">
        <Field label="Instrument" error={errors.symbol}>{(p) => <input {...p} className={cx(inputClass, "uppercase")} maxLength={20} value={form.symbol} onChange={(e) => set("symbol", e.target.value)} />}</Field>
        <div className="flex flex-col gap-1 text-[13px] text-ink-soft">
          Direction
          <Segmented label="Direction" value={form.side} onChange={(v) => set("side", v)} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
        </div>
        <Field label="When" error={errors.at} className="col-span-2 sm:col-span-1 lg:col-span-2">{(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={form.at} onChange={(e) => set("at", e.target.value)} />}</Field>
        <Field label="Entry" error={errors.entryPrice}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.entry} onChange={(e) => set("entry", e.target.value)} />}</Field>
        <Field label="Stop" error={errors.stopPrice}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.stop} onChange={(e) => set("stop", e.target.value)} />}</Field>
        <Field label="Would have exited" error={errors.exitPrice}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.exit} onChange={(e) => set("exit", e.target.value)} />}</Field>
        <Field label="Why you passed" error={errors.reason} className="col-span-2 sm:col-span-3 lg:col-span-6">{(p) => <input {...p} className={inputClass} maxLength={500} value={form.reason} onChange={(e) => set("reason", e.target.value)} />}</Field>
        <Button type="submit" className="self-end max-sm:h-11" disabled={!form.symbol.trim() || !form.entry.trim()}>Log missed trade</Button>
      </form>
    </Card>
  );
}
