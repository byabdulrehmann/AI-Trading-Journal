"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Facets } from "@/lib/client/analytics";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { SESSION_LABELS, dateTime, fileSize, money } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { COACHING_STYLES, type ActivityEvent, type SHARING_LEVELS } from "@/lib/domain/types";
import { OP_LABELS, RULE_FIELDS, type RuleCondition, type RuleField } from "@/lib/domain/autotag";
import { Badge, Button, Field, PageHeader, Segmented, Spinner, Toggle, cx, inputClass } from "@/components/ui";
import { RecoveryCode } from "@/components/AuthFrame";

const SHARING: { value: (typeof SHARING_LEVELS)[number]; label: string; detail: string }[] = [
  { value: "metrics", label: "Metrics only", detail: "Totals, win rate, R statistics and pattern summaries. No individual trades." },
  { value: "trades", label: "Trades without notes", detail: "Adds up to 25 recent trades: symbol, times, P&L, R, setup, feelings, plan flag, grade." },
  { value: "trades_with_notes", label: "Trades with notes", detail: "Also includes your plan notes and written notes for those trades." },
];

const STYLE_LABEL: Record<(typeof COACHING_STYLES)[number], string> = { direct: "Direct", supportive: "Supportive", analytical: "Analytical" };

/** A ruled form section: its name on the left, its fields on the right. */
function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-3 border-t border-line py-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Password() {
  const { toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/password", { method: "POST", json: { current, next } });
      setCurrent("");
      setNext("");
      toast({ message: "Password changed. Other devices were signed out.", tone: "success" });
    } catch (err) {
      const fields = fieldErrors(err);
      setError(fields.next ?? (err instanceof Error ? err.message : "Couldn't change the password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="password" title="Password" description="Changing it signs out everywhere else.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,16rem)_auto] sm:items-end">
        <Field label="Current password">
          {(p) => <input {...p} type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label="New password">
          {(p) => <input {...p} type="password" autoComplete="new-password" minLength={10} className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} required />}
        </Field>
        <Button type="submit" disabled={busy}>{busy ? "Changing" : "Change password"}</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-[13px] text-loss">{error}</p>}
    </Section>
  );
}

/** A new recovery code for a forgotten password. The old one stops working; the new one is shown once. */
function Recovery() {
  const { data, reload } = useFetch<{ hasCode: boolean }>("/api/auth/recovery");
  const [current, setCurrent] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ recoveryCode: string }>("/api/auth/recovery", { method: "POST", json: { current } });
      setCurrent("");
      setCode(res.recoveryCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make a new code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="recovery" title="Recovery code" description="The way back in if you forget your password: Jarvis can't send email. Making a new code replaces the old one.">
      {code ? (
        <div className="max-w-md">
          <RecoveryCode code={code} doneLabel="Done" onDone={() => (setCode(null), reload())} />
        </div>
      ) : (
        <>
          {data && !data.hasCode && <p className="mb-3 text-[13.5px] text-warn">This account has no recovery code yet. Make one now, so a forgotten password isn&apos;t the end of this journal.</p>}
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end">
            <Field label="Current password">
              {(p) => <input {...p} type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} required />}
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Making a code" : data?.hasCode ? "Make a new code" : "Make a recovery code"}</Button>
          </form>
          {error && <p role="alert" className="mt-2 text-[13px] text-loss">{error}</p>}
        </>
      )}
    </Section>
  );
}

export default function SettingsPage() {
  const { settings, saveSettings, user } = useApp();
  if (!settings) return <Spinner label="Loading your settings" />;
  const j = settings.jarvis;

  return (
    <>
      <PageHeader title="Settings" description="Preferences, privacy and your data. Everything is stored in a local database on this computer." />
      <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {[["profile", "Profile"], ["defaults", "Trading defaults"], ["password", "Password"], ["recovery", "Recovery code"], ["sessions", "Signed-in browsers"], ["accounts", "Accounts"], ["autotags", "Auto-tags"], ["jarvis", "AI Coach"], ["ai-key", "AI key"], ["privacy", "Privacy"], ["data", "Your data"], ...(user?.isOwner ? [["backups", "Backups"], ["signups", "New accounts"], ["market-data", "Market data"], ["early-access", "Early access"]] : [])].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="py-1 text-ink-soft underline-offset-2 hover:text-ink hover:underline pointer-coarse:py-3">{l}</a>
        ))}
      </nav>

      <Section id="profile" title="Profile">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_auto] sm:justify-start">
          <Field label="Display name" hint="Used to greet you">
            {(p) => <input {...p} className={inputClass} defaultValue={settings.displayName} maxLength={40} onBlur={(e) => e.target.value !== settings.displayName && void saveSettings({ displayName: e.target.value })} />}
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-ink-soft">Theme</span>
            <Segmented label="Theme" value={settings.theme} onChange={(theme) => void saveSettings({ theme })} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          </div>
        </div>
      </Section>

      <TradingDefaults />

      <Password />
      <Recovery />
      <Sessions />

      <Accounts />

      <AutoTags />

      <Section id="jarvis" title="AI Coach" description={<>Model and provider are chosen on the <Link href="/jarvis" className="text-ink underline">AI Coach</Link> page, under Model.</>}>
        <div className="divide-y divide-line">
          <Toggle label="Enable the AI Coach" checked={j.enabled} onChange={(v) => void saveSettings({ jarvis: { enabled: v } })} description="When off, the panel is hidden and no messages are processed. Saved history is kept." />
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-[14px] font-medium">Coaching style</p>
              <p className="text-[13px] text-muted">How the coach phrases its replies.</p>
            </div>
            <Segmented label="Coaching style" value={j.coachingStyle} onChange={(coachingStyle) => void saveSettings({ jarvis: { coachingStyle } })} options={COACHING_STYLES.map((s) => ({ value: s, label: STYLE_LABEL[s] }))} />
          </div>
          <Toggle label="Behavioural insights" checked={j.behaviouralInsights} onChange={(v) => void saveSettings({ jarvis: { behaviouralInsights: v } })} description="Detects patterns like fast re-entries after losses. Turn off to stop pattern analysis everywhere, including the AI Coach." />
          <Toggle label="Reflection prompts" checked={j.reflectionPrompts} onChange={(v) => void saveSettings({ jarvis: { reflectionPrompts: v } })} description="A reminder on the dashboard about recent trades with no plan answer. Shown in the app only." />
        </div>
      </Section>

      <AiKey isOwner={!!user?.isOwner} />
      <Privacy />
      <DataControls />
      {user?.isOwner && <Backups />}
      {user?.isOwner && <Signups />}
      {user?.isOwner && <FredKey />}
      {user?.isOwner && <EarlyAccess />}
    </>
  );
}

/** Only what the browser knows. An older browser without the list still offers this computer's zone. */
const zones = (): string[] => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);

function FeeDefault({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [error, setError] = useState<string | undefined>();
  return (
    <Field label={label} error={error}>
      {(p) => (
        <input
          {...p}
          className={cx(inputClass, "num")}
          inputMode="decimal"
          defaultValue={value || ""}
          onBlur={(e) => {
            const next = e.target.value.trim() === "" ? 0 : Number(e.target.value);
            if (!Number.isFinite(next) || next < 0) return setError("Enter 0 or more");
            setError(undefined);
            if (next !== value) onSave(next);
          }}
        />
      )}
    </Field>
  );
}

/** Percent results are worked out from this, and synced accounts start with none because deposits aren't journaled. */
function StartingBalance({ id, name, currency, value }: { id: number; name: string; currency: string; value: number }) {
  const { refresh, toast } = useApp();
  const [error, setError] = useState<string | undefined>();
  return (
    <label className="flex flex-col gap-0.5 text-[12.5px] text-muted">
      Starting balance, {currency}
      <input
        key={value}
        aria-label={`Starting balance of ${name}`}
        className={cx(inputClass, "num h-8 w-32! text-[13px] max-sm:h-11")}
        inputMode="decimal"
        defaultValue={value}
        onBlur={async (e) => {
          const next = Number(e.target.value.trim() || 0);
          if (!Number.isFinite(next) || next < 0) return setError("Enter 0 or more");
          setError(undefined);
          if (next === value) return;
          try {
            await api(`/api/accounts/${id}`, { method: "PATCH", json: { startingBalance: next } });
            await refresh();
            toast({ message: `Starting balance of ${name} saved.`, tone: "success" });
          } catch (err) {
            toast({ message: err instanceof Error ? err.message : "Couldn't save the balance.", tone: "error" });
          }
        }}
      />
      {error && <span className="text-loss">{error}</span>}
    </label>
  );
}

function TradingDefaults() {
  const { settings, saveSettings } = useApp();
  if (!settings) return null;
  const fees = settings.feeDefaults;
  const options = zones();
  return (
    <Section id="defaults" title="Trading defaults" description="Days, calendars and reports follow the time zone you pick here.">
      <div className="grid max-w-md grid-cols-2 gap-4">
        <Field label="Time zone" className="col-span-2" hint="Files with no zone of their own are still read in this computer's time.">
          {(p) => (
            <select {...p} className={inputClass} value={settings.timeZone} onChange={(e) => void saveSettings({ timeZone: e.target.value })}>
              <option value="">This computer&apos;s time zone</option>
              {options.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          )}
        </Field>
        <FeeDefault label="Commission" value={fees.commission} onSave={(commission) => void saveSettings({ feeDefaults: { ...fees, commission } })} />
        <FeeDefault label="Other fees" value={fees.otherFees} onSave={(otherFees) => void saveSettings({ feeDefaults: { ...fees, otherFees } })} />
      </div>
      <p className="mt-2 text-[13px] text-muted">The two fee amounts start every new trade you log by hand, where you can still change them. Imported and synced trades keep their own.</p>
      <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Daily plan template" hint="Offered when a day's plan is empty.">
          {(p) => <textarea {...p} rows={6} maxLength={2000} className={cx(inputClass, "h-auto py-1.5")} defaultValue={settings.journalTemplates.plan} onBlur={(e) => e.target.value !== settings.journalTemplates.plan && void saveSettings({ journalTemplates: { ...settings.journalTemplates, plan: e.target.value } })} />}
        </Field>
        <Field label="Daily recap template" hint="Offered when a day's recap is empty.">
          {(p) => <textarea {...p} rows={6} maxLength={2000} className={cx(inputClass, "h-auto py-1.5")} defaultValue={settings.journalTemplates.recap} onBlur={(e) => e.target.value !== settings.journalTemplates.recap && void saveSettings({ journalTemplates: { ...settings.journalTemplates, recap: e.target.value } })} />}
        </Field>
      </div>
    </Section>
  );
}

function Accounts() {
  const { accounts, refresh, toast, settings, saveSettings } = useApp();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [balance, setBalance] = useState("10000");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const add = async () => {
    try {
      await api("/api/accounts", { method: "POST", json: { name, broker: "", currency, startingBalance: Number(balance) || 0 } });
      setName("");
      setErrors({});
      await refresh();
    } catch (e) {
      setErrors(fieldErrors(e));
    }
  };
  const archive = async (id: number, archived: boolean) => {
    await api(`/api/accounts/${id}`, { method: "PATCH", json: { archived } });
    await refresh();
    toast({ message: archived ? "Account archived. Its trades stay in your journal." : "Account restored." });
  };

  return (
    <Section id="accounts" title="Trading accounts" description={<>MetaTrader 5 connections are managed under <Link href="/accounts" className="text-ink underline">Accounts &amp; MT5</Link>.</>}>
      <ul className="divide-y divide-line border-y border-line">
        {accounts.filter((a) => a.source !== "backtest").map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-medium">{a.name} {a.isSample && <Badge tone="info">Sample</Badge>} {a.archived && <Badge>Archived</Badge>}</p>
              <p className="text-[12.5px] text-muted"><span className="num">{a.currency}</span>, starting <span className="num">{money(a.startingBalance, a.currency)}</span></p>
            </div>
            <StartingBalance id={a.id} name={a.name} currency={a.currency} value={a.startingBalance} />
            {settings?.defaultAccountId === a.id ? (
              <span className="flex items-center gap-1.5 px-3 text-[13px] text-ink"><span aria-hidden className="h-2 w-2 bg-accent" />Default</span>
            ) : (
              !a.archived && <Button size="sm" variant="ghost" onClick={() => void saveSettings({ defaultAccountId: a.id })}>Make default</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void archive(a.id, !a.archived)}>{a.archived ? "Restore" : "Archive"}</Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_auto] sm:items-start">
        <Field label="New account name" error={errors.name}>{(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Currency" error={errors.currency}>{(p) => <input {...p} className={cx(inputClass, "num uppercase")} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />}</Field>
        <Field label="Starting balance" error={errors.startingBalance}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />}</Field>
        <Button className="sm:mt-[1.5rem]" onClick={add} disabled={!name.trim()}>Add account</Button>
      </div>
    </Section>
  );
}

function Privacy() {
  const { settings, saveSettings, toast } = useApp();
  const [activity, setActivity] = useState<{ events: ActivityEvent[]; types: Record<string, string> } | null>(null);
  const [preview, setPreview] = useState<{ provider: string; external: boolean; disclosure: string[] } | null>(null);
  const loadActivity = useCallback(() => api<NonNullable<typeof activity>>("/api/activity").then(setActivity), []);
  // Re-read both whenever a setting changes, since sharing and tracking affect them.
  useEffect(() => {
    api<NonNullable<typeof activity>>("/api/activity").then(setActivity);
    api<NonNullable<typeof preview>>("/api/jarvis/context").then(setPreview);
  }, [settings]);
  if (!settings) return null;
  const j = settings.jarvis;

  return (
    <Section id="privacy" title="Privacy" description="What the AI Coach can use, what is recorded, and what leaves this computer.">
      <div className="space-y-5">
        <section>
          <h3 className="text-[14px] font-medium">Sharing with external AI providers</h3>
          <p className="mt-1 text-[13px] text-muted">Applies only when a provider such as Anthropic is active. Demo mode never sends anything.</p>
          <div role="radiogroup" aria-label="Sharing level" className="mt-2 divide-y divide-line border-y border-line">
            {SHARING.map((s) => {
              const on = j.sharing === s.value;
              return (
                <button key={s.value} type="button" role="radio" aria-checked={on} onClick={() => void saveSettings({ jarvis: { sharing: s.value } })} className="flex w-full items-start gap-3 py-2.5 text-left hover:bg-raised">
                  <span aria-hidden className={cx("mt-1 h-3 w-3 shrink-0 border", on ? "border-accent bg-accent" : "border-line-strong")} />
                  <span>
                    <span className="block text-[14px] font-medium">{s.label}</span>
                    <span className="block text-[13px] text-muted">{s.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {preview && (
            <div className="mt-3 bg-sunken p-3 text-[13px]">
              <p className="font-medium">
                Right now, a message would go to {preview.provider}
                {preview.external ? " and include:" : ". It runs locally; nothing is sent."}
              </p>
              {preview.external && (
                <ul className="mt-1 list-disc pl-5 text-ink-soft">
                  {preview.disclosure.map((d) => <li key={d}>{d}</li>)}
                  <li>The last 20 messages of the conversation</li>
                </ul>
              )}
              <p className="mt-2 text-muted">Your API key, account balances and the activity log are never sent.</p>
            </div>
          )}
        </section>

        <section className="divide-y divide-line border-y border-line">
          <Toggle label="AI Coach memory" checked={j.memoryEnabled} onChange={(v) => void saveSettings({ jarvis: { memoryEnabled: v } })} description={<>Lets the coach use the notes you&apos;ve asked it to remember. Manage them on the <Link href="/jarvis" className="underline">AI Coach</Link> page, under Memory.</>} />
          <Toggle
            label="Record app activity"
            checked={settings.activityTracking}
            onChange={async (v) => {
              await saveSettings({ activityTracking: v });
              toast({ message: v ? "Activity recording is on. Nothing is sent anywhere." : "Activity recording paused." });
            }}
            description="Off by default. When on, Jarvis keeps a local log of the actions below. The log stays on this computer: it isn't sent to the AI Coach or any provider."
          />
        </section>

        {activity && (
          <section>
            <h3 className="text-[14px] font-medium">What activity recording captures</h3>
            <ul className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-ink-soft sm:grid-cols-2">
              {Object.entries(activity.types).map(([k, v]) => (
                <li key={k}><code className="num text-[12px] text-muted">{k}</code>: {v}</li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">Jarvis does not record page views, clicks, keystrokes, time on page, or chat content.</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <h3 className="text-[14px] font-medium">Recorded events (<span className="num">{activity.events.length}</span>)</h3>
              <Button size="sm" variant="danger" disabled={!activity.events.length} onClick={async () => { await api("/api/activity", { method: "DELETE" }); await loadActivity(); }}>Delete log</Button>
            </div>
            {activity.events.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Nothing recorded.</p>
            ) : (
              <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto border-y border-line text-[12.5px]" tabIndex={0} aria-label="Recorded events, local time">
                {activity.events.map((e) => (
                  <li key={e.id} className="flex gap-3 py-1.5">
                    <span className="num whitespace-nowrap text-muted">{dateTime(e.createdAt)}</span>
                    <code className="num">{e.type}</code>
                    <code className="num truncate text-muted">{JSON.stringify(e.detail)}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Section>
  );
}

function DataControls() {
  const { refresh, toast } = useApp();
  const [confirmText, setConfirmText] = useState("");
  const hasSample = useFetch<Facets>("/api/facets").data?.hasSample;

  return (
    <Section id="data" title="Your data" description="Stored in a database file inside the app's data folder.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/data" className="inline-flex h-9 items-center border border-line-strong px-3.5 text-sm font-medium transition-colors hover:bg-raised" download>
            Export everything (JSON)
          </a>
          {hasSample ? (
            <Button onClick={async () => { const r = await api<{ removed: number }>("/api/data/sample", { method: "DELETE" }); await refresh(); toast({ message: `Removed ${r.removed} sample trades.` }); }}>Remove sample data</Button>
          ) : (
            <Button onClick={async () => { const r = await api<{ added: number }>("/api/data/sample", { method: "POST" }); await refresh(); toast({ message: `Loaded ${r.added} sample trades.`, tone: "success" }); }}>Load sample data</Button>
          )}
        </div>
        <div className="border-t border-line pt-4">
          <h3 className="text-[14px] font-medium">Delete all data</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">Permanently removes trades, accounts, attachments, settings, AI Coach conversations, memories and the activity log. Your sign-in stays. Export first if you want a copy. Database backups made before keep their copy until they are deleted under Backups.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="confirm-delete" className="sr-only">Type DELETE to confirm</label>
            <input id="confirm-delete" className={cx(inputClass, "sm:w-56")} placeholder="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <Button
              variant="danger"
              disabled={confirmText !== "DELETE"}
              onClick={async () => {
                await api("/api/data", { method: "DELETE", json: { confirm: "DELETE" } });
                setConfirmText("");
                await refresh();
                toast({ message: "All data deleted." });
              }}
            >
              Delete everything
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}

interface TagRule {
  id: number;
  tag: string;
  conditions: RuleCondition[];
  tagged: number;
}

const WEEKDAY_LABELS: Record<string, string> = { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" };
const valueLabel = (field: RuleField, v: string) => (field === "session" ? (SESSION_LABELS[v] ?? v) : field === "weekday" ? WEEKDAY_LABELS[v] : field === "hour" ? `${v.padStart(2, "0")}:00` : v);
const conditionText = (c: RuleCondition) => `${RULE_FIELDS[c.field].label.toLowerCase()} ${OP_LABELS[c.op]} ${valueLabel(c.field, c.value)}`;
const blankCondition = (): RuleCondition => ({ field: "symbol", op: "is", value: "" });

function AutoTags() {
  const { toast, refresh } = useApp();
  const { data, reload } = useFetch<{ rules: TagRule[] }>("/api/tag-rules");
  const [tag, setTag] = useState("");
  const [conditions, setConditions] = useState<RuleCondition[]>([blankCondition()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setCondition = (i: number, patch: Partial<RuleCondition>) => setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ tagged: number }>("/api/tag-rules", { method: "POST", json: { tag, conditions } });
      toast({ message: `Rule saved. ${r.tagged} trade${r.tagged === 1 ? "" : "s"} tagged ${tag}.`, tone: "success" });
      setTag("");
      setConditions([blankCondition()]);
      setErrors({});
      reload();
      await refresh();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: err instanceof Error ? err.message : "Couldn't save the rule.", tone: "error" });
    }
  };
  const remove = async (r: TagRule) => {
    try {
      await api(`/api/tag-rules/${r.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't delete the rule.", tone: "error" });
    }
  };

  return (
    <Section id="autotags" title="Auto-tags" description="Tags added for you when a trade matches. A rule tags each trade once: remove the tag from a trade and it stays removed. Rules about the result wait until the trade closes.">
      {data?.rules.length ? (
        <ul className="mb-4 divide-y divide-line border-y border-line" data-testid="tag-rules">
          {data.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13.5px]">
              <Badge tone="accent">{r.tag}</Badge>
              <span className="order-last min-w-0 basis-full text-ink-soft sm:order-none sm:flex-1 sm:basis-0">when {r.conditions.map(conditionText).join(", and ")}</span>
              <span className="num text-[12.5px] text-muted">{r.tagged} tagged</span>
              <Button size="sm" variant="ghost" aria-label={`Delete the ${r.tag} rule`} onClick={() => void remove(r)}>Delete</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[13.5px] text-muted">No rules yet.</p>
      )}
      <form onSubmit={add} className="flex max-w-3xl flex-col gap-3" noValidate>
        <Field label="Tag" error={errors.tag} className="sm:w-64">{(p) => <input {...p} className={inputClass} maxLength={30} placeholder="Quick loss" value={tag} onChange={(e) => setTag(e.target.value)} />}</Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] text-ink-soft">When all of these are true</legend>
          {conditions.map((c, i) => {
            const f = RULE_FIELDS[c.field];
            const err = errors[`conditions.${i}.value`] ?? errors[`conditions.${i}.op`];
            return (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[12rem_10rem_minmax(0,1fr)_auto]">
                <label className="sr-only" htmlFor={`cond-field-${i}`}>Condition {i + 1}</label>
                <select id={`cond-field-${i}`} className={inputClass} value={c.field} onChange={(e) => { const field = e.target.value as RuleField; const nf = RULE_FIELDS[field]; setCondition(i, { field, op: nf.ops[0], value: "options" in nf ? nf.options[0] : "" }); }}>
                  {Object.entries(RULE_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <label className="sr-only" htmlFor={`cond-op-${i}`}>Comparison {i + 1}</label>
                <select id={`cond-op-${i}`} className={inputClass} value={c.op} onChange={(e) => setCondition(i, { op: e.target.value })}>
                  {f.ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                </select>
                <label className="sr-only" htmlFor={`cond-value-${i}`}>Value {i + 1}</label>
                {"options" in f ? (
                  <select id={`cond-value-${i}`} className={inputClass} value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })}>
                    {f.options.map((o) => <option key={o} value={o}>{valueLabel(c.field, o)}</option>)}
                  </select>
                ) : (
                  <input id={`cond-value-${i}`} className={cx(inputClass, c.field !== "symbol" && "num")} inputMode={c.field === "symbol" ? undefined : "decimal"} aria-invalid={err ? true : undefined} value={c.value} placeholder={c.field === "symbol" ? "EURUSD" : c.field === "hour" ? "0 to 23" : ""} onChange={(e) => setCondition(i, { value: e.target.value })} />
                )}
                <Button type="button" variant="ghost" size="sm" className="self-center" disabled={conditions.length === 1} aria-label={`Remove condition ${i + 1}`} onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}>Remove</Button>
                {err && <p className="col-span-full text-[12.5px] text-loss">{err}</p>}
              </div>
            );
          })}
          {errors.conditions && <p className="text-[12.5px] text-loss">{errors.conditions}</p>}
        </fieldset>
        <p className="text-[12.5px] text-muted">Hours and days are in your time zone. News means a timed high-impact event in your Economic calendar for a currency the symbol names; a symbol naming none, like a stock, counts every currency.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={conditions.length >= 5} onClick={() => setConditions((cs) => [...cs, blankCondition()])}>Add a condition</Button>
          <Button type="submit" variant="primary">Save rule</Button>
        </div>
      </form>
    </Section>
  );
}

interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  kind: "manual" | "auto" | "migration";
  encrypted: boolean;
}
const BACKUP_KIND = { manual: "Made by you", auto: "Automatic", migration: "Before an update" } as const;

interface EarlyAccessRequest {
  id: number;
  name: string;
  email: string;
  trades: string;
  message: string;
  createdAt: string;
}

type KeyCall = (init: Parameters<typeof api>[1], done: string) => Promise<void>;

/** Save, check and remove one secret key. The key never comes back from the server; `extra` adds controls that share the busy state. */
function KeyForm({ endpoint, saved, label, hint, savedMessage, removeLabel, removedMessage, reload, extra }: {
  endpoint: string;
  saved: boolean;
  label: [empty: string, replace: string];
  hint: string;
  savedMessage: string;
  removeLabel: string;
  removedMessage: string;
  reload: () => void;
  extra?: (call: KeyCall, busy: boolean) => React.ReactNode;
}) {
  const { toast } = useApp();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call: KeyCall = async (init, done) => {
    setBusy(true);
    setError(null);
    try {
      await api(endpoint, init);
      setKey("");
      toast({ message: done, tone: "success" });
      reload();
    } catch (err) {
      setError(fieldErrors(err).key ?? (err instanceof Error ? err.message : "Couldn't save it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={(e) => (e.preventDefault(), void call({ method: "PUT", json: { key } }, savedMessage))} className="grid gap-3 sm:grid-cols-[minmax(0,22rem)_auto] sm:items-end">
        <Field label={saved ? label[1] : label[0]} hint={hint}>
          {(p) => <input {...p} type="password" autoComplete="off" spellCheck={false} className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} required />}
        </Field>
        <Button type="submit" disabled={busy}>{busy ? "Checking" : "Save key"}</Button>
      </form>
      {error && <p role="alert" className="text-[13px] text-loss">{error}</p>}
      {saved && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void call({ method: "DELETE" }, removedMessage)}>{removeLabel}</Button>}
      {extra?.(call, busy)}
    </>
  );
}

/** Owner only: the install's FRED key, for the macro side of the Market page's scorecard. */
function FredKey() {
  const { data, reload } = useFetch<{ configured: boolean }>("/api/market/fred-key");
  return (
    <Section
      id="market-data"
      title="Market data"
      description={<>A free FRED key from the St. Louis Fed adds interest rates, growth and jobs to the Market page&rsquo;s scorecard, for every account. Get one at fred.stlouisfed.org under My Account, API Keys. It&rsquo;s stored encrypted on this computer and only ever sent to FRED.</>}
    >
      {data && (
        <div className="space-y-4" data-testid="fred-key">
          <p className="text-[13.5px] text-ink-soft">FRED key: <span className="font-medium text-ink">{data.configured ? "saved" : "not set"}</span></p>
          <KeyForm endpoint="/api/market/fred-key" saved={data.configured} label={["FRED API key", "Replace the key"]} hint="32 letters and digits. Jarvis checks it with FRED before saving." savedMessage="FRED key saved." removeLabel="Remove the key" removedMessage="FRED key removed." reload={reload} />
        </div>
      )}
    </Section>
  );
}

/** This account's own Anthropic key, and for the owner whether accounts without one may use theirs. */
function AiKey({ isOwner }: { isOwner: boolean }) {
  const { data, reload } = useFetch<{ ownKey: boolean; using: "own" | "owner" | "none"; ownerSharing: boolean; ownerHasKey: boolean }>("/api/jarvis/key");
  const using = { own: "Your own key: you pay Anthropic for what you use.", owner: "The owner's key, shared with this account.", none: "No key: the AI Coach runs in demo mode." } as const;

  return (
    <Section id="ai-key" title="AI key" description="The Anthropic key the AI Coach uses for this account. A saved key is stored encrypted on this computer and never shown again, not even to you.">
      {data && (
        <div className="space-y-4" data-testid="ai-key">
          <p className="text-[13.5px] text-ink-soft">Using now: <span className="font-medium text-ink">{using[data.using]}</span></p>
          <KeyForm
            endpoint="/api/jarvis/key"
            saved={data.ownKey}
            label={["Your Anthropic key", "Replace your key"]}
            hint="Starts with sk-ant-. Jarvis checks it with Anthropic before saving."
            savedMessage="Key saved."
            removeLabel="Remove my key"
            removedMessage="Key removed."
            reload={reload}
            extra={(call, busy) =>
              isOwner && (
                <Toggle
                  label="Share my key with accounts that have none"
                  checked={data.ownerSharing}
                  disabled={busy}
                  onChange={(share) => void call({ method: "PATCH", json: { share } }, share ? "Your key is shared." : "Your key is no longer shared.")}
                  description={data.ownerHasKey ? "Your key is ANTHROPIC_API_KEY on the server. Shared, it's capped at 30 messages a minute and 500 a day per account." : "ANTHROPIC_API_KEY isn't set on the server, so there's nothing to share yet."}
                />
              )
            }
          />
        </div>
      )}
    </Section>
  );
}

interface SessionInfo {
  id: number;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** Every browser signed in to this account, and a way to sign the others out. */
function Sessions() {
  const { toast } = useApp();
  const { data, error, reload } = useFetch<{ sessions: SessionInfo[] }>("/api/auth/sessions");
  const end = async (id?: number) => {
    try {
      await api("/api/auth/sessions", { method: "DELETE", json: id ? { id } : {} });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't sign it out.", tone: "error" });
    }
  };
  const others = data?.sessions.filter((s) => !s.current).length ?? 0;
  return (
    <Section id="sessions" title="Signed-in browsers" description="A browser stays signed in for up to 14 days, and is signed out after 3 days without use.">
      {error && !data && <p className="text-[13.5px] text-loss">{error}</p>}
      {data && (
        <>
          <ul className="divide-y divide-line border-y border-line" data-testid="sessions">
            {data.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 text-[13.5px]">
                  <p className="font-medium text-ink">
                    Signed in <span className="num">{dateTime(s.createdAt)}</span>
                    {s.current && <Badge className="ml-2">This browser</Badge>}
                  </p>
                  <p className="text-muted">Signs out by <span className="num">{dateTime(s.expiresAt)}</span> unless used</p>
                </div>
                {!s.current && <Button size="sm" variant="ghost" onClick={() => void end(s.id)}>Sign out</Button>}
              </li>
            ))}
          </ul>
          {others > 0 && <Button className="mt-3" onClick={() => void end()}>Sign out every other browser</Button>}
        </>
      )}
    </Section>
  );
}

/** Whether people who reach this computer can make their own account. Owner only. */
function Signups() {
  const { toast } = useApp();
  const { data, reload } = useFetch<{ open: boolean }>("/api/signups");
  const set = async (open: boolean) => {
    try {
      await api("/api/signups", { method: "PUT", json: { open } });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't change it.", tone: "error" });
    }
  };
  return (
    <Section id="signups" title="New accounts" description="Each account is a separate private journal, and every account uses this computer's AI key.">
      {data && <Toggle label="Allow new accounts" checked={data.open} onChange={(v) => void set(v)} description="When off, the sign-up page tells visitors to ask you. Existing accounts keep working." />}
    </Section>
  );
}

/** Requests from the marketing site's form. Owner only, like backups: they belong to the installation, not a journal. */
function EarlyAccess() {
  const { toast } = useApp();
  const { data, error, reload } = useFetch<{ requests: EarlyAccessRequest[] }>("/api/early-access");
  const remove = async (r: EarlyAccessRequest) => {
    if (!confirm(`Delete the request from ${r.name}? This can't be undone.`)) return;
    try {
      await api(`/api/early-access/${r.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't delete it.", tone: "error" });
    }
  };
  return (
    <Section id="early-access" title="Early access requests" description="Sent from the website's early-access form (/contact). They are stored here only: nothing is emailed, and no account is created. Each request is deleted after 90 days.">
      {error && !data && <p className="text-[13.5px] text-loss">{error}</p>}
      {data && (data.requests.length ? (
        <ul className="divide-y divide-line" data-testid="early-access-requests">
          {data.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">{r.name} <span className="font-normal text-ink-soft">{r.email}</span></p>
                {r.trades && <p className="text-[13.5px] text-ink-soft">Trades: {r.trades}</p>}
                {r.message && <p className="mt-1 text-[13.5px] whitespace-pre-wrap text-ink-soft">{r.message}</p>}
                <p className="num mt-1 text-[12.5px] text-muted">{dateTime(r.createdAt)}</p>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Delete the request from ${r.name}`} onClick={() => void remove(r)}>Delete</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-muted">No requests yet.</p>
      ))}
    </Section>
  );
}

/** The password that encrypts every backup. Jarvis keeps no copy of it: without it, nobody can open them, the owner included. */
function BackupPassword({ locked, onDone }: { locked: boolean; onDone: () => void }) {
  const { toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!locked);

  const save = async (reset = false) => {
    if (next !== repeat) return setError("These passwords don't match.");
    if (reset && !confirm("Start over with a new backup password? Backups encrypted with the old one stay locked to it, and only the old password opens them.")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/backups/password", { method: "PUT", json: { next, current: locked && !reset ? current : undefined, reset } });
      setCurrent("");
      setNext("");
      setRepeat("");
      setOpen(false);
      toast({ message: locked ? "Backup password changed." : "Backups are now encrypted.", tone: "success" });
      onDone();
    } catch (err) {
      setError(fieldErrors(err).next ?? (err instanceof Error ? err.message : "Couldn't save it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl" data-testid="backup-password">
      {locked ? (
        <p className="text-[13.5px] text-ink-soft">Backups are encrypted with your backup password. Jarvis keeps no copy of it: without it, nobody can open them, you included.</p>
      ) : (
        <p className="text-[13.5px] text-warn">Backups aren&apos;t encrypted yet: anyone with a copy of one can read every journal in it. Set a backup password to encrypt them, the ones already made included.</p>
      )}
      {locked && !open && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(true)}>Change backup password</Button>}
      {open && (
        <form onSubmit={(e) => (e.preventDefault(), void save())} className="mt-3 grid gap-3 sm:grid-cols-[repeat(3,minmax(0,13rem))] sm:items-end">
          {locked && (
            <Field label="Current backup password">
              {(p) => <input {...p} type="password" autoComplete="off" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />}
            </Field>
          )}
          <Field label="New backup password" hint="At least 10 characters.">
            {(p) => <input {...p} type="password" autoComplete="new-password" minLength={10} className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} required />}
          </Field>
          <Field label="Repeat it">
            {(p) => <input {...p} type="password" autoComplete="new-password" className={inputClass} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />}
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" disabled={busy}>{locked ? "Change it" : "Encrypt backups"}</Button>
            {locked && <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(true)}>Forgot it? Start over</Button>}
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-loss">{error}</p>}
    </div>
  );
}

/** An encrypted backup as a plain database file, for restoring on this computer. */
function DecryptBackup({ backups }: { backups: BackupFile[] }) {
  const [name, setName] = useState(backups[0].name);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(name)}/decrypt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't decrypt it.");
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: name.replace(/\.sealed$/, "") });
      a.click();
      URL.revokeObjectURL(url);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't decrypt it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={download} className="grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_auto] sm:items-end" data-testid="decrypt-backup">
      <Field label="Download a backup decrypted">
        {(p) => (
          <select {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)}>
            {backups.map((b) => <option key={b.name} value={b.name}>{dateTime(b.createdAt)}, {BACKUP_KIND[b.kind].toLowerCase()}</option>)}
          </select>
        )}
      </Field>
      <Field label="Backup password">
        {(p) => <input {...p} type="password" autoComplete="off" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} required />}
      </Field>
      <Button type="submit" disabled={busy}>{busy ? "Decrypting" : "Download"}</Button>
      {error && <p role="alert" className="text-[13px] text-loss sm:col-span-3">{error}</p>}
    </form>
  );
}

function Backups() {
  const { toast } = useApp();
  const { data, error, reload } = useFetch<{ backups: BackupFile[]; folder: string; locked: boolean }>("/api/backups");
  const [busy, setBusy] = useState(false);
  const encrypted = data?.backups.filter((b) => b.encrypted) ?? [];

  const make = async () => {
    setBusy(true);
    try {
      await api("/api/backups", { method: "POST" });
      toast({ message: "Backup made.", tone: "success" });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't make the backup.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (b: BackupFile) => {
    if (!confirm(`Delete the backup from ${dateTime(b.createdAt)}? This can't be undone.`)) return;
    try {
      await api(`/api/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't delete it.", tone: "error" });
    }
  };

  return (
    <Section id="backups" title="Backups" description="Full copies of the database: every user's journal on this computer. Jarvis makes one a day while it runs and keeps the last seven. Stored MT5 passwords stay encrypted in them, and the key isn't in the file.">
      <div className="space-y-4">
        {data && <BackupPassword locked={data.locked} onDone={reload} />}
        <Button variant="primary" disabled={busy} onClick={() => void make()}>{busy ? "Backing up…" : "Back up now"}</Button>
        {error && !data && <p className="text-[13.5px] text-loss">{error}</p>}
        {data && (data.backups.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]" data-testid="backups">
              <thead className="text-left text-[12.5px] text-muted"><tr className="border-b border-line"><th scope="col" className="py-1.5 font-normal">Made</th><th scope="col" className="py-1.5 pl-3 font-normal">Kind</th><th scope="col" className="py-1.5 pl-3 text-right font-normal">Size</th><td /></tr></thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.name} className="border-b border-line">
                    <td className="num py-1.5 whitespace-nowrap">{dateTime(b.createdAt)}</td>
                    <td className="py-1.5 pl-3 text-ink-soft">{BACKUP_KIND[b.kind]}{b.encrypted ? <Badge className="ml-2">Encrypted</Badge> : <Badge tone="warn" className="ml-2">Not encrypted</Badge>}</td>
                    <td className="num py-1.5 pl-3 text-right">{fileSize(b.size)}</td>
                    <td className="py-1.5 pl-3 text-right whitespace-nowrap">
                      <a href={`/api/backups/${encodeURIComponent(b.name)}`} download className="mr-1 inline-flex h-8 items-center px-3 text-[13px] text-ink-soft hover:bg-raised hover:text-ink">Download</a>
                      <Button size="sm" variant="ghost" aria-label={`Delete the backup from ${dateTime(b.createdAt)}`} onClick={() => void remove(b)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[13.5px] text-muted">No backups yet.</p>)}
        {encrypted.length > 0 && <DecryptBackup backups={encrypted} />}
        {data && (
          <div className="max-w-2xl text-[13px] text-muted">
            <p className="font-medium text-ink-soft">To restore one</p>
            <p className="mt-1">An encrypted backup first has to be turned back into a database file: download it decrypted above, or on another computer run <span className="num">node scripts/decrypt-backup.mjs</span> with the file. Then stop Jarvis and copy the backup over <span className="num">kestrel.db</span> in the data folder, one level above <span className="num break-all">{data.folder}</span>. Delete <span className="num">kestrel.db-wal</span> and <span className="num">kestrel.db-shm</span> beside it if they are there, then start Jarvis. Jarvis never restores by itself, so no click can replace your journal.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
