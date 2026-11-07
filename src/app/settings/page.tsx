"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Facets } from "@/lib/client/analytics";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { COACHING_STYLES, type ActivityEvent, type SHARING_LEVELS } from "@/lib/domain/types";
import { Badge, Button, Field, PageHeader, Segmented, Spinner, Toggle, cx, inputClass } from "@/components/ui";

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

export default function SettingsPage() {
  const { settings, saveSettings } = useApp();
  if (!settings) return <Spinner label="Loading your settings" />;
  const j = settings.jarvis;

  return (
    <>
      <PageHeader title="Settings" description="Preferences, privacy and your data. Everything is stored in a local database on this computer." />
      <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {[["profile", "Profile"], ["defaults", "Trading defaults"], ["password", "Password"], ["accounts", "Accounts"], ["jarvis", "AI Coach"], ["privacy", "Privacy"], ["data", "Your data"]].map(([id, l]) => (
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

      <Accounts />

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

      <Privacy />
      <DataControls />
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
          <p className="mt-1 max-w-2xl text-[13px] text-muted">Permanently removes trades, accounts, attachments, settings, AI Coach conversations, memories and the activity log. Your sign-in stays. Export first if you want a copy.</p>
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
