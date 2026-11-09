"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money, pct, rFmt, toneOf } from "@/lib/client/format";
import type { ReviewFacts } from "@/lib/domain/review";
import { RichText } from "@/components/jarvis/RichText";
import { useFetch } from "@/lib/client/use-fetch";
import { addDays, GOAL_KINDS, type ChallengeResult, type GoalKind, type GoalResult, type RuleCheck, type RuleState, type Streak } from "@/lib/domain/progress";
import { zoneDateKey } from "@/lib/domain/zone";
import { ChallengeAlerts } from "@/components/progress/ChallengeAlerts";
import { Suspended } from "@/components/Suspended";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Notice, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

interface Challenge {
  id: number;
  accountId: number;
  accountName: string;
  currency: string;
  name: string;
  firm: string;
  startDate: string;
  endDate: string | null;
  accountSize: number;
  profitTarget: number | null;
  dailyLoss: number | null;
  maxLoss: number | null;
  maxLossType: "static" | "trailing";
  minDays: number;
  consistencyPct: number | null;
  resetZone: string;
  resetHour: number;
  archived: boolean;
  isSample: boolean;
  result: ChallengeResult;
  floatingAt: string | null;
  excluded: number;
}

interface Expense {
  id: number;
  date: string;
  kind: string;
  amount: number;
  currency: string;
  firm: string;
  challengeId: number | null;
  note: string;
  income: boolean;
}
interface Spending {
  expenses: Expense[];
  summary: { currency: string; spent: number; received: number; net: number; firms: { firm: string; spent: number; received: number; net: number }[] }[];
}

interface Goal {
  id: number;
  kind: GoalKind;
  period: "week" | "month";
  target: number;
  currency: string | null;
  accountId: number | null;
  label: string;
  unit: "money" | "percent" | "count";
  current: GoalResult & { from: string; to: string };
  previous: GoalResult & { from: string; to: string };
}
interface Overview {
  today: string;
  streaks: { key: string; label: string; unit: string; streak: Streak; detail: string }[];
  goals: Goal[];
}
interface RoutineData {
  today: string;
  day: { date: string; items: { id: number; label: string; checked: boolean }[] };
}

const KIND_LABELS: Record<string, string> = { fee: "Challenge fee", reset: "Reset", subscription: "Subscription", other: "Other cost", payout: "Payout", refund: "Fee refund" };
const TABS = [
  { value: "challenges", label: "Challenges" },
  { value: "routine", label: "Routine and goals" },
  { value: "spending", label: "Spending" },
  { value: "reviews", label: "Reviews" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** A day key as a date, without moving it through any time zone. */
const dayLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const num = (s: string) => (s.trim() === "" ? null : Number(s));
const toast$ = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export default function ProgressPage() {
  return (
    <Suspended>
      <Progress />
    </Suspended>
  );
}

function Progress() {
  const search = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.value === search.get("tab"))?.value ?? "challenges") as Tab;
  const sample = search.get("includeSample") === "1";
  const go = (t: Tab) => {
    const q = new URLSearchParams(search);
    q.set("tab", t);
    router.replace(`/progress?${q}`);
  };
  return (
    <div>
      <PageHeader title="Progress" description="Prop firm challenges and their rules, what they cost you, the habits behind your trading, and a review of each week or month." />
      <ChallengeAlerts includeSample={sample} link={false} />
      <div className="mb-4">
        <Segmented label="Section" value={tab} onChange={go} options={[...TABS]} />
      </div>
      {tab === "challenges" && <Challenges sample={sample} />}
      {tab === "routine" && <RoutineAndGoals sample={sample} />}
      {tab === "spending" && <SpendingTab />}
      {tab === "reviews" && <Reviews sample={sample} />}
    </div>
  );
}

// ---------- challenges ----------

const stateTone = (s: RuleState) => ({ ok: "neutral", warn: "warn", breached: "loss", met: "profit", pending: "info" }[s] as "neutral" | "warn" | "loss" | "profit" | "info");
const stateWord = (s: RuleState) => ({ ok: "Within limit", warn: "Close to limit", breached: "Breached", met: "Met", pending: "Not yet" }[s]);
const statusBadge = { active: { tone: "info", text: "In progress" }, passed: { tone: "profit", text: "Passed" }, failed: { tone: "loss", text: "Failed" }, expired: { tone: "warn", text: "Out of time" } } as const;

function Challenges({ sample }: { sample: boolean }) {
  const { toast } = useApp();
  const { data, error, reload } = useFetch<{ challenges: Challenge[] }>(`/api/challenges${sample ? "?includeSample=1" : ""}`);
  const [editing, setEditing] = useState<Challenge | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const act = async (c: Challenge, what: "archive" | "restore" | "delete") => {
    if (what === "delete" && !confirm(`Delete the challenge "${c.name}"? Its trades stay in the journal, and its spending stays, unlinked.`)) return;
    try {
      if (what === "delete") await api(`/api/challenges/${c.id}`, { method: "DELETE" });
      else await api(`/api/challenges/${c.id}`, { method: "PUT", json: { ...pick(c), archived: what === "archive" } });
      reload();
    } catch (e) {
      toast({ message: toast$(e, "Couldn't change it."), tone: "error" });
    }
  };

  if (error && !data) return <EmptyState title="Couldn't load your challenges" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading challenges" />;
  const live = data.challenges.filter((c) => !c.archived);
  const archived = data.challenges.filter((c) => c.archived);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" className="max-sm:h-11" onClick={() => setEditing("new")}>New challenge</Button>
      </div>
      {live.length === 0 && (
        <EmptyState
          title="No challenges yet"
          body="Add a prop firm challenge or funded account: its account, size and rules. Jarvis checks every closed trade against them, counts open MT5 positions for today, and warns you before a limit breaks."
          action={<Button variant="primary" onClick={() => setEditing("new")}>New challenge</Button>}
        />
      )}
      {live.map((c) => <ChallengeCard key={c.id} c={c} onEdit={() => setEditing(c)} onArchive={() => void act(c, "archive")} onDelete={() => void act(c, "delete")} />)}
      {archived.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" aria-expanded={showArchived} onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide" : "Show"} {archived.length} archived</Button>
          {showArchived && <div className="mt-3 flex flex-col gap-4">{archived.map((c) => <ChallengeCard key={c.id} c={c} onEdit={() => setEditing(c)} onArchive={() => void act(c, "restore")} onDelete={() => void act(c, "delete")} />)}</div>}
        </div>
      )}
      <ChallengeForm editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </div>
  );
}

const pick = (c: Challenge) => ({
  accountId: c.accountId, name: c.name, firm: c.firm, startDate: c.startDate, endDate: c.endDate, accountSize: c.accountSize, profitTarget: c.profitTarget, dailyLoss: c.dailyLoss,
  maxLoss: c.maxLoss, maxLossType: c.maxLossType, minDays: c.minDays, consistencyPct: c.consistencyPct, resetZone: c.resetZone, resetHour: c.resetHour,
});

function Meter({ progress, state, label }: { progress: number; state: RuleState; label: string }) {
  const w = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)} className="h-1.5 w-full bg-sunken">
      <div className={cx("h-full", { ok: "bg-ink-soft", warn: "bg-warn", breached: "bg-loss", met: "bg-profit", pending: "bg-info" }[state])} style={{ width: `${w}%` }} />
    </div>
  );
}

function ruleNumbers(r: RuleCheck, currency: string): string {
  if (r.key === "days") return `${r.value} of ${r.limit} days`;
  if (r.key === "time") return `Day ${r.value} of ${r.limit}`;
  if (r.key === "consistency") return `${Math.round(r.value)}% of ${r.limit}% allowed`;
  if (r.key === "target") return `${money(r.value, currency, true)} of ${money(r.limit, currency)}`;
  return `${money(r.value, currency)} of ${money(r.limit, currency)} used`;
}

function ruleDetail(r: RuleCheck, c: Challenge): string {
  const res = c.result;
  if (r.state === "breached" && res.breach && (r.key === "daily" || r.key === "max")) return `Breached on ${dayLabel(res.breach.day)}.`;
  if (r.key === "target") return r.state === "met" ? "Reached." : `${money(r.limit - r.value, c.currency)} to go.`;
  if (r.key === "daily") return `${money(Math.max(0, r.limit - r.value), c.currency)} left today.`;
  if (r.key === "time") return r.state === "breached" ? `Ended on ${dayLabel(c.endDate!)}.` : `${r.limit - r.value} ${r.limit - r.value === 1 ? "day" : "days"} left, to ${dayLabel(c.endDate!)}.`;
  if (r.key === "max") return `Floor at ${money(res.floor, c.currency)}, ${money(Math.max(0, res.equity - (res.floor ?? 0)), c.currency)} above it.`;
  return r.detail;
}

function ChallengeCard({ c, onEdit, onArchive, onDelete }: { c: Challenge; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const r = c.result;
  const badge = statusBadge[r.status];
  return (
    <Card data-testid="challenge-card">
      <CardHeader
        title={c.name}
        subtitle={<span>{[c.firm, c.accountName, `${money(c.accountSize, c.currency)} account`, `from ${dayLabel(c.startDate)}`].filter(Boolean).join(", ")}</span>}
        action={<span className="flex items-center gap-2">{c.isSample && <Badge tone="info">Sample</Badge>}<Badge tone={badge.tone}>{badge.text}</Badge></span>}
      />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-4">
        <div><dt className="text-[12.5px] text-muted">Balance</dt><dd className="num">{money(r.balance, c.currency)}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Profit</dt><dd className={cx("num", toneOf(r.profit))}>{money(r.profit, c.currency, true)}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Today</dt><dd className={cx("num", toneOf(r.today.closed + (r.today.floating ?? 0)))}>{money(r.today.closed + (r.today.floating ?? 0), c.currency, true)}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Trading days</dt><dd className="num">{r.tradingDays}</dd></div>
      </dl>
      {r.breach && (
        <div className="mt-3">
          <Notice tone="loss">
            {r.breach.rule === "daily" ? "The daily loss limit" : "The max loss limit"} was reached on {dayLabel(r.breach.day)}. Most firms end the challenge at that point; check yours.
          </Notice>
        </div>
      )}
      <ul className="mt-4 flex flex-col gap-3" aria-label={`Rules for ${c.name}`}>
        {r.rules.map((rule) => (
          <li key={rule.key} data-testid={`rule-${rule.key}`}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
              <span className="font-medium">{rule.label}</span>
              <span className="flex items-center gap-2">
                <span className="num text-ink-soft">{ruleNumbers(rule, c.currency)}</span>
                <Badge tone={stateTone(rule.state)}>{rule.key === "consistency" && rule.state === "warn" ? "Not met" : stateWord(rule.state)}</Badge>
              </span>
            </div>
            <Meter progress={rule.progress} state={rule.state} label={`${rule.label}: ${ruleNumbers(rule, c.currency)}`} />
            <p className="mt-1 text-[12.5px] text-muted">{ruleDetail(rule, c)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-muted">
        {c.floatingAt ? `Today includes ${money(r.today.floating, c.currency, true)} on open positions, from the MT5 sync at ${dateTime(c.floatingAt)}.` : "Counts closed trades. Open positions count only on an MT5 account synced today."}
        {c.excluded > 0 && ` ${c.excluded} closed ${c.excluded === 1 ? "trade is" : "trades are"} left out: no result yet (a missing rate or fills to fix).`}
        {` Days start at ${String(c.resetHour).padStart(2, "0")}:00${c.resetZone ? ` ${c.resetZone.replace(/_/g, " ")}` : ", your time zone"}.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" className="max-sm:h-11" onClick={onEdit}>Edit rules</Button>
        <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={onArchive}>{c.archived ? "Restore" : "Archive"}</Button>
        <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Delete ${c.name}`} onClick={onDelete}>Delete</Button>
      </div>
    </Card>
  );
}

function ChallengeForm({ editing, onClose, onSaved }: { editing: Challenge | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { accounts, settings, toast } = useApp();
  const choices = accounts.filter((a) => a.source !== "backtest" && !a.archived);
  const blank = () => {
    const c = editing && editing !== "new" ? editing : null;
    const s = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
    return {
      accountId: String(c?.accountId ?? choices.find((a) => !a.isSample)?.id ?? choices[0]?.id ?? ""),
      name: c?.name ?? "",
      firm: c?.firm ?? "",
      startDate: c?.startDate ?? zoneDateKey(Date.now(), settings?.timeZone || undefined),
      endDate: c?.endDate ?? "",
      accountSize: s(c?.accountSize),
      profitTarget: s(c?.profitTarget),
      dailyLoss: s(c?.dailyLoss),
      maxLoss: s(c?.maxLoss),
      maxLossType: c?.maxLossType ?? "static",
      minDays: s(c?.minDays ?? 0),
      consistencyPct: s(c?.consistencyPct),
      resetZone: c?.resetZone ?? "",
      resetHour: s(c?.resetHour ?? 0),
    };
  };
  const [form, setForm] = useState(blank);
  const [openFor, setOpenFor] = useState<typeof editing>(null);
  if (editing !== openFor) {
    setOpenFor(editing);
    if (editing) setForm(blank());
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const size = Number(form.accountSize) || 0;
  const share = (v: string) => (size > 0 && num(v) ? `${Math.round((num(v)! / size) * 1000) / 10}% of the account.` : undefined);
  const fillTypical = () => {
    if (!size) return setErrors({ accountSize: "Enter the account size first" });
    setForm((f) => ({ ...f, profitTarget: String(size * 0.1), dailyLoss: String(size * 0.05), maxLoss: String(size * 0.1), maxLossType: "static" }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload = { accountId: Number(form.accountId), name: form.name, firm: form.firm, startDate: form.startDate, endDate: form.endDate || null, accountSize: num(form.accountSize), profitTarget: num(form.profitTarget), dailyLoss: num(form.dailyLoss), maxLoss: num(form.maxLoss), maxLossType: form.maxLossType, minDays: num(form.minDays) ?? 0, consistencyPct: num(form.consistencyPct), resetZone: form.resetZone.trim(), resetHour: num(form.resetHour) ?? 0 };
    try {
      if (editing && editing !== "new") await api(`/api/challenges/${editing.id}`, { method: "PUT", json: payload });
      else await api("/api/challenges", { method: "POST", json: payload });
      setErrors({});
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: toast$(err, "Couldn't save the challenge."), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const money$ = (k: "accountSize" | "profitTarget" | "dailyLoss" | "maxLoss", label: string, hint?: string) => (
    <Field label={label} error={errors[k]} hint={hint ?? (k === "accountSize" ? undefined : share(form[k]) ?? "Leave empty if there's no such rule.")}>
      {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );

  return (
    <Dialog open={editing !== null} onClose={onClose} title={editing && editing !== "new" ? `Edit ${editing.name}` : "New challenge"} persistent wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2" noValidate>
        <Field label="Name" error={errors.name}>{(p) => <input {...p} data-autofocus className={inputClass} maxLength={60} value={form.name} placeholder="100k, phase 1" onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Firm" error={errors.firm} hint="Optional.">{(p) => <input {...p} className={inputClass} maxLength={60} value={form.firm} onChange={(e) => set("firm", e.target.value)} />}</Field>
        <Field label="Account" error={errors.accountId} hint="Its trades are the ones checked.">
          {(p) => <select {...p} className={inputClass} value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>{choices.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isSample ? " (sample)" : ""}</option>)}</select>}
        </Field>
        {money$("accountSize", "Account size")}
        <Field label="Starts" error={errors.startDate}>{(p) => <input {...p} type="date" className={cx(inputClass, "num")} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />}</Field>
        <Field label="Ends" error={errors.endDate} hint="Optional: the last day allowed.">{(p) => <input {...p} type="date" className={cx(inputClass, "num")} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />}</Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <p className="text-[13px] text-ink-soft">Rules, in the account&apos;s currency.</p>
          <Button size="sm" variant="ghost" onClick={fillTypical}>Fill common two-step rules</Button>
        </div>
        {money$("profitTarget", "Profit target")}
        {money$("dailyLoss", "Daily loss limit")}
        {money$("maxLoss", "Max loss")}
        <Field label="Max loss is" error={errors.maxLossType} hint={form.maxLossType === "trailing" ? "The floor follows your highest closed balance up, and stops at the account size." : "The floor stays at the account size minus the max loss."}>
          {(p) => <select {...p} className={inputClass} value={form.maxLossType} onChange={(e) => set("maxLossType", e.target.value)}><option value="static">Fixed from the start</option><option value="trailing">Trailing</option></select>}
        </Field>
        <Field label="Minimum trading days" error={errors.minDays}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="numeric" value={form.minDays} onChange={(e) => set("minDays", e.target.value)} />}</Field>
        <Field label="Consistency, best day at most" error={errors.consistencyPct} hint="Percent of the total profit. Optional.">{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.consistencyPct} onChange={(e) => set("consistencyPct", e.target.value)} />}</Field>
        <Field label="Day starts at (hour)" error={errors.resetHour} hint="When the firm's daily limit resets, 0 to 23.">{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="numeric" value={form.resetHour} onChange={(e) => set("resetHour", e.target.value)} />}</Field>
        <Field label="In time zone" error={errors.resetZone} hint="Like Europe/Prague. Empty: your time zone.">{(p) => <input {...p} className={inputClass} maxLength={64} value={form.resetZone} onChange={(e) => set("resetZone", e.target.value)} />}</Field>
        <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || choices.length === 0}>{busy ? "Saving…" : "Save challenge"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- routine, streaks and goals ----------

function RoutineAndGoals({ sample }: { sample: boolean }) {
  const overview = useFetch<Overview>(`/api/progress${sample ? "?includeSample=1" : ""}`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Routine onChange={overview.reload} />
      <Card>
        <CardHeader title="Streaks" subtitle="Weekends neither count nor break a run of days." />
        {!overview.data ? (
          <Spinner label="Loading streaks" />
        ) : (
          <dl className="grid grid-cols-2 gap-4" data-testid="streaks">
            {overview.data.streaks.map((s) => (
              <div key={s.key} data-testid={`streak-${s.key}`}>
                <dt className="text-[13px] text-ink-soft">{s.label}</dt>
                <dd className="num text-2xl font-medium">{s.streak.current}<span className="ml-1 text-[13px] font-normal text-muted">{s.unit}</span></dd>
                <dd className="text-[12.5px] text-muted">Best {s.streak.best}. {s.detail}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
      <div className="lg:col-span-2">
        <Goals data={overview.data} reload={overview.reload} />
      </div>
    </div>
  );
}

function Routine({ onChange }: { onChange: () => void }) {
  const { toast } = useApp();
  const { data, reload } = useFetch<RoutineData>("/api/routine");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string>();
  // Shown at once; dropped again if saving fails.
  const [ticked, setTicked] = useState<Record<number, boolean>>({});
  const tick = async (date: string, itemId: number, checked: boolean) => {
    setTicked((t) => ({ ...t, [itemId]: checked }));
    try {
      await api("/api/routine/checks", { method: "PUT", json: { date, itemId, checked } });
      onChange();
    } catch (e) {
      setTicked((t) => ({ ...t, [itemId]: !checked }));
      toast({ message: toast$(e, "Couldn't save that."), tone: "error" });
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
      onChange();
    } catch (e) {
      toast({ message: toast$(e, "Couldn't save that."), tone: "error" });
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/routine", { method: "POST", json: { label } });
      setLabel("");
      setError(undefined);
      reload();
      onChange();
    } catch (err) {
      setError(fieldErrors(err).label ?? toast$(err, "Couldn't add it."));
    }
  };

  return (
    <Card>
      <CardHeader title="Today's routine" subtitle={data ? dayLabel(data.today) : undefined} />
      {!data ? (
        <Spinner label="Loading routine" />
      ) : (
        <>
          {data.day.items.length === 0 ? (
            <p className="text-[13.5px] text-ink-soft">Add the steps you do before trading, like checking the news calendar or marking your levels. Tick them off each day to build a streak.</p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="routine">
              {data.day.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2.5 text-[14px]">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={ticked[i.id] ?? i.checked} onChange={(e) => void tick(data.today, i.id, e.target.checked)} />
                    <span className={cx((ticked[i.id] ?? i.checked) && "text-muted line-through")}>{i.label}</span>
                  </label>
                  <Button size="sm" variant="ghost" aria-label={`Retire ${i.label}`} onClick={() => void run(() => api(`/api/routine/${i.id}`, { method: "PATCH", json: { archived: true } }))}>Retire</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
            <Field label="New step" error={error} className="flex-1">{(p) => <input {...p} className={inputClass} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
            <Button type="submit" className="mt-[22px]">Add</Button>
          </form>
          {data.day.items.length > 0 && <p className="mt-2 text-[12.5px] text-muted">Retiring a step keeps the days it was done. It drops off from today.</p>}
        </>
      )}
    </Card>
  );
}

const goalValue = (g: Goal, v: number | null) => (v === null ? "—" : g.unit === "money" ? money(g.kind === "max_day_loss" ? -v : v, g.currency ?? "USD", g.kind === "net_pnl") : g.unit === "percent" ? `${v}%` : String(v));
const goalTarget = (g: Goal) => (g.unit === "money" ? money(g.kind === "max_day_loss" ? -g.target : g.target, g.currency ?? "USD") : g.unit === "percent" ? `${g.target}%` : String(g.target));
const goalTone = { met: "profit", on_track: "info", behind: "neutral", missed: "loss", no_data: "neutral" } as const;
const goalWord = { met: "Met", on_track: "On track", behind: "Not yet", missed: "Missed", no_data: "No data yet" } as const;

function Goals({ data, reload }: { data: Overview | undefined; reload: () => void }) {
  const { toast, settings } = useApp();
  const [form, setForm] = useState({ kind: "net_pnl" as GoalKind, period: "week" as "week" | "month", target: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = GOAL_KINDS[form.kind].unit;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/goals", { method: "POST", json: { kind: form.kind, period: form.period, target: num(form.target) ?? Number.NaN } });
      setForm((f) => ({ ...f, target: "" }));
      setErrors({});
      reload();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { target: toast$(err, "Couldn't add the goal.") });
    }
  };
  const remove = async (g: Goal) => {
    try {
      await api(`/api/goals/${g.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      toast({ message: toast$(e, "Couldn't delete it."), tone: "error" });
    }
  };

  return (
    <Card>
      <CardHeader title="Goals" subtitle="This week or month, from your closed trades, daily journal and routine. Weeks start on Monday." />
      {!data ? (
        <Spinner label="Loading goals" />
      ) : data.goals.length === 0 ? (
        <p className="text-[13.5px] text-ink-soft">No goals yet. Set one below: a result to reach, or a limit to stay within.</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="goals">
          {data.goals.map((g) => (
            <li key={g.id} data-testid="goal">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[13.5px]">
                <span className="font-medium">{g.label} {goalTarget(g)}, each {g.period}</span>
                <span className="flex items-center gap-2">
                  <span className="num text-ink-soft">{goalValue(g, g.current.value)}</span>
                  <Badge tone={goalTone[g.current.state]}>{goalWord[g.current.state]}</Badge>
                  <Button size="sm" variant="ghost" aria-label={`Delete goal ${g.label}`} onClick={() => void remove(g)}>Delete</Button>
                </span>
              </div>
              <Meter progress={g.current.progress} state={g.current.state === "met" ? "met" : g.current.state === "missed" ? "breached" : g.current.state === "on_track" ? "ok" : "pending"} label={`${g.label}: ${goalValue(g, g.current.value)} of ${goalTarget(g)}`} />
              <p className="mt-1 text-[12.5px] text-muted">{g.current.detail} Last {g.period}: {goalValue(g, g.previous.value)}, {goalWord[g.previous.state].toLowerCase()}.</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_auto_10rem_auto]" noValidate>
        <Field label="Goal" error={errors.kind}>{(p) => <select {...p} className={inputClass} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as GoalKind }))}>{Object.entries(GOAL_KINDS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select>}</Field>
        <Field label="Each" error={errors.period}>{(p) => <select {...p} className={inputClass} value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "week" | "month" }))}><option value="week">Week</option><option value="month">Month</option></select>}</Field>
        <Field label={unit === "money" ? `Amount (${settings?.baseCurrency ?? "USD"})` : unit === "percent" ? "Percent" : "Number"} error={errors.target}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />}</Field>
        <Button type="submit" className="self-end">Add goal</Button>
      </form>
    </Card>
  );
}

// ---------- spending ----------

function SpendingTab() {
  const { toast, settings } = useApp();
  const { data, error, reload } = useFetch<Spending>("/api/expenses");
  const challenges = useFetch<{ challenges: Challenge[] }>("/api/challenges");
  const blank = () => ({ date: zoneDateKey(Date.now(), settings?.timeZone || undefined), kind: "fee", amount: "", currency: settings?.baseCurrency ?? "USD", firm: "", challengeId: "", note: "" });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/expenses", { method: "POST", json: { ...form, amount: num(form.amount) ?? Number.NaN, challengeId: form.challengeId ? Number(form.challengeId) : null } });
      setForm((f) => ({ ...blank(), date: f.date, currency: f.currency, firm: f.firm }));
      setErrors({});
      reload();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: toast$(err, "Couldn't add it."), tone: "error" });
    }
  };
  const remove = async (x: Expense) => {
    if (!confirm(`Delete this ${KIND_LABELS[x.kind].toLowerCase()} of ${money(x.amount, x.currency)}?`)) return;
    try {
      await api(`/api/expenses/${x.id}`, { method: "DELETE" });
      reload();
    } catch (e2) {
      toast({ message: toast$(e2, "Couldn't delete it."), tone: "error" });
    }
  };

  if (error && !data) return <EmptyState title="Couldn't load your spending" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading spending" />;
  return (
    <div className="flex flex-col gap-4">
      {data.summary.map((s) => (
        <Card key={s.currency} data-testid="spending-summary">
          <CardHeader title={`In ${s.currency}`} subtitle="Fees, resets and subscriptions, against payouts and refunds. Amounts in different currencies are never added together." />
          <dl className="grid grid-cols-3 gap-4 text-[13.5px]">
            <div><dt className="text-[12.5px] text-muted">Spent</dt><dd className="num text-lg">{money(s.spent, s.currency)}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Received</dt><dd className="num text-lg">{money(s.received, s.currency)}</dd></div>
            <div><dt className="text-[12.5px] text-muted">Net</dt><dd className={cx("num text-lg", toneOf(s.net))} data-testid="spending-net">{money(s.net, s.currency, true)}</dd></div>
          </dl>
          {s.firms.length > 1 && (
            <table className="mt-3 w-full text-[13px]">
              <thead className="text-left text-[12.5px] text-muted"><tr className="border-b border-line"><th scope="col" className="py-1 font-normal">Firm</th><th scope="col" className="py-1 text-right font-normal">Spent</th><th scope="col" className="py-1 text-right font-normal">Received</th><th scope="col" className="py-1 text-right font-normal">Net</th></tr></thead>
              <tbody>{s.firms.map((f) => <tr key={f.firm} className="border-b border-line"><th scope="row" className="py-1 text-left font-normal">{f.firm}</th><td className="num py-1 text-right">{money(f.spent, s.currency)}</td><td className="num py-1 text-right">{money(f.received, s.currency)}</td><td className={cx("num py-1 text-right", toneOf(f.net))}>{money(f.net, s.currency, true)}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
      ))}
      <Card>
        <CardHeader title="Add an entry" />
        <form onSubmit={add} className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4" noValidate>
          <Field label="Date" error={errors.date}>{(p) => <input {...p} type="date" className={cx(inputClass, "num")} value={form.date} onChange={(e) => set("date", e.target.value)} />}</Field>
          <Field label="What" error={errors.kind}>{(p) => <select {...p} className={inputClass} value={form.kind} onChange={(e) => set("kind", e.target.value)}>{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</Field>
          <Field label="Amount" error={errors.amount}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />}</Field>
          <Field label="Currency" error={errors.currency}>{(p) => <input {...p} className={cx(inputClass, "uppercase")} maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value)} />}</Field>
          <Field label="Firm" error={errors.firm}>{(p) => <input {...p} className={inputClass} maxLength={60} value={form.firm} onChange={(e) => set("firm", e.target.value)} />}</Field>
          <Field label="Challenge" error={errors.challengeId} hint="Optional.">{(p) => <select {...p} className={inputClass} value={form.challengeId} onChange={(e) => set("challengeId", e.target.value)}><option value="">None</option>{challenges.data?.challenges.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
          <Field label="Note" error={errors.note} className="col-span-2">{(p) => <input {...p} className={inputClass} maxLength={200} value={form.note} onChange={(e) => set("note", e.target.value)} />}</Field>
          <div className="col-span-2 flex justify-end sm:col-span-4"><Button type="submit" variant="primary">Add entry</Button></div>
        </form>
      </Card>
      {data.expenses.length > 0 && (
        <Card>
          <CardHeader title="Entries" />
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]" data-testid="expenses">
              <thead className="text-left text-[12.5px] text-muted"><tr className="border-b border-line"><th scope="col" className="py-1.5 font-normal">Date</th><th scope="col" className="py-1.5 pl-3 font-normal">What</th><th scope="col" className="py-1.5 pl-3 font-normal max-sm:hidden">Firm</th><th scope="col" className="py-1.5 pl-3 text-right font-normal">Amount</th><td /></tr></thead>
              <tbody>
                {data.expenses.map((x) => (
                  <tr key={x.id} className="border-b border-line">
                    <td className="num py-1.5">{dayLabel(x.date)}</td>
                    <td className="py-1.5 pl-3">{KIND_LABELS[x.kind]}{x.note && <span className="text-muted">, {x.note}</span>}</td>
                    <td className="py-1.5 pl-3 text-ink-soft max-sm:hidden">{x.firm || "—"}</td>
                    <td className={cx("num py-1.5 pl-3 text-right", x.income ? "text-profit" : "")}>{money(x.income ? x.amount : -x.amount, x.currency, true)}</td>
                    <td className="py-1.5 pl-3 text-right"><Button size="sm" variant="ghost" aria-label={`Delete ${KIND_LABELS[x.kind]} on ${dayLabel(x.date)}`} onClick={() => void remove(x)}>Delete</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- reviews ----------

interface Review {
  period: "week" | "month";
  from: string;
  to: string;
  currencies: { currency: string; facts: ReviewFacts }[];
  hasSample: boolean;
  saved: { provider: string; model: string; text: string; shared: string[]; createdAt: string } | null;
  ai: { available: boolean; label: string; reason: string | null; external: boolean };
}

const MISTAKE_WORDS = (m: string) => m.replace(/_/g, " ");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Reviews({ sample }: { sample: boolean }) {
  const { settings, openTrade, toast } = useApp();
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [date, setDate] = useState(() => zoneDateKey(Date.now(), settings?.timeZone || undefined));
  const { data, error, reload } = useFetch<Review>(`/api/reviews?period=${period}&date=${date}${sample ? "&includeSample=1" : ""}`);
  const [writing, setWriting] = useState(false);
  const title = data ? (period === "week" ? `Week of ${dayLabel(data.from)}` : new Date(`${data.from}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })) : "";
  const anyTrades = data?.currencies.some((c) => c.facts.closedTrades > 0);

  const write = async () => {
    setWriting(true);
    try {
      await api(`/api/reviews${sample ? "?includeSample=1" : ""}`, { method: "POST", json: { period, date } });
      reload();
    } catch (err) {
      toast({ message: toast$(err, "Couldn't write the review."), tone: "error" });
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <div className="flex items-center gap-1">
          <Button size="sm" aria-label={`Previous ${period}`} onClick={() => data && setDate(addDays(data.from, -1))}>Previous</Button>
          <Button size="sm" aria-label={`Next ${period}`} onClick={() => data && setDate(addDays(data.to, 1))}>Next</Button>
        </div>
        <h2 className="text-[15.5px] font-medium" data-testid="review-title">{title}</h2>
      </div>

      {error && !data ? (
        <EmptyState title="Couldn't load the review" body={error} action={<Button onClick={reload}>Try again</Button>} />
      ) : !data ? (
        <Spinner label="Loading the review" />
      ) : !anyTrades ? (
        <EmptyState title={`No closed trades this ${period}`} body="The review fills in from the trades you close in it." />
      ) : (
        <>
          {data.currencies.filter((c) => c.facts.closedTrades > 0 || c.facts.previous.closedTrades > 0).map(({ currency, facts: f }) => (
            <Card key={currency} data-testid="review">
              <CardHeader title={data.currencies.length > 1 ? `In ${currency}` : "The numbers"} subtitle={data.hasSample ? "Includes sample trades." : "Counted from your closed trades. Nothing here is estimated."} />
              <dl className="grid grid-cols-2 gap-4 text-[13.5px] sm:grid-cols-4">
                <div><dt className="text-[12.5px] text-muted">Net P&amp;L</dt><dd className={cx("num text-lg", toneOf(f.netPnl))} data-testid="review-net">{money(f.netPnl, currency, true)}</dd></div>
                <div><dt className="text-[12.5px] text-muted">Trades</dt><dd className="num text-lg">{f.closedTrades}<span className="text-[13px] text-muted"> ({f.wins} won, {f.losses} lost)</span></dd></div>
                <div><dt className="text-[12.5px] text-muted">Win rate</dt><dd className="num text-lg">{pct(f.winRate)}</dd></div>
                <div><dt className="text-[12.5px] text-muted">Average R</dt><dd className="num text-lg">{rFmt(f.avgR)}{f.rSample > 0 && f.rSample < f.closedTrades && <span className="text-[13px] text-muted"> from {f.rSample}</span>}</dd></div>
              </dl>
              <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13.5px] text-ink-soft" data-testid="review-lines">
                <li>{plural(f.tradingDays, "trading day")}: {f.winningDays} green, {f.losingDays} red.{f.bestDay && f.tradingDays > 1 ? ` Best ${dayLabel(f.bestDay.date)} at ${money(f.bestDay.pnl, currency, true)}` : ""}{f.worstDay && f.worstDay.pnl < 0 ? `${f.tradingDays > 1 ? "," : ""} worst ${dayLabel(f.worstDay.date)} at ${money(f.worstDay.pnl, currency, true)}` : ""}{f.tradingDays > 1 ? "." : ""}</li>
                {f.best && f.worst && f.best.id !== f.worst.id && (
                  <li>Best trade <button type="button" className="underline underline-offset-2" onClick={() => openTrade(f.best!.id)}>{f.best.symbol} #{f.best.id}</button> at {money(f.best.pnl, currency, true)}; worst <button type="button" className="underline underline-offset-2" onClick={() => openTrade(f.worst!.id)}>{f.worst.symbol} #{f.worst.id}</button> at {money(f.worst.pnl, currency, true)}.</li>
                )}
                {f.symbols.length > 0 && <li>Most traded: {f.symbols.map((s) => `${s.symbol} (${plural(s.trades, "trade")}, ${money(s.pnl, currency, true)})`).join(", ")}.</li>}
                <li>{f.planSample ? `Plan followed on ${pct(f.planAdherence)} of the ${plural(f.planSample, "trade")} you marked.` : "No trades marked as on or off plan."}</li>
                {f.mistakes.length > 0 && <li>Mistakes marked: {f.mistakes.map((m) => `${MISTAKE_WORDS(m.mistake)} (${m.trades})`).join(", ")}.</li>}
                <li>The {period} before: {f.previous.closedTrades ? `${plural(f.previous.closedTrades, "trade")}, ${money(f.previous.netPnl, currency, true)}, win rate ${pct(f.previous.winRate)}.` : "no closed trades."}</li>
              </ul>
            </Card>
          ))}

          <Card data-testid="ai-review">
            <CardHeader title="Written review" subtitle={data.saved ? `Written by ${data.saved.model} on ${dateTime(data.saved.createdAt)}. It can be wrong: the numbers above are the record.` : "An AI model reads this period's record and writes a short review: what happened, possible patterns, and a thing or two to try."} />
            {data.saved && (
              <div className="text-[14px] leading-relaxed">
                <RichText text={data.saved.text} />
                <details className="mt-3 text-[12.5px] text-muted">
                  <summary className="cursor-pointer">What was sent</summary>
                  <ul className="mt-1 list-disc pl-5">{data.saved.shared.map((s) => <li key={s}>{s}</li>)}</ul>
                </details>
              </div>
            )}
            {data.ai.available ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant={data.saved ? "secondary" : "primary"} disabled={writing} onClick={() => void write()}>{writing ? "Writing…" : data.saved ? "Write it again" : "Write the review"}</Button>
                <p className="text-[12.5px] text-muted">{data.ai.external ? `Sends this ${period}'s totals, and its trades as your Privacy setting allows, to ${data.ai.label}.` : `Uses ${data.ai.label}.`}</p>
              </div>
            ) : (
              !data.saved && <Notice tone="info">{data.ai.reason}</Notice>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
