"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Facets } from "@/lib/client/analytics";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { COACHING_STYLES, type ActivityEvent, type SHARING_LEVELS } from "@/lib/domain/types";
import { Badge, Button, Card, CardHeader, Field, PageHeader, Segmented, Spinner, Toggle, cx, inputClass } from "@/components/ui";

const SHARING: { value: (typeof SHARING_LEVELS)[number]; label: string; detail: string }[] = [
  { value: "metrics", label: "Metrics only", detail: "Totals, win rate, R statistics and pattern summaries. No individual trades." },
  { value: "trades", label: "Trades without notes", detail: "Adds up to 25 recent trades: symbol, times, P&L, R, setup, feelings, plan flag, grade." },
  { value: "trades_with_notes", label: "Trades with notes", detail: "Also includes your plan notes and written notes for those trades." },
];

const STYLE_LABEL: Record<(typeof COACHING_STYLES)[number], string> = { direct: "Direct", supportive: "Supportive", analytical: "Analytical" };

export default function SettingsPage() {
  const { settings, saveSettings } = useApp();
  if (!settings) return <Spinner />;
  const j = settings.jarvis;

  return (
    <>
      <PageHeader title="Settings" description="Preferences, privacy and your data. Everything is stored in a local database on this computer." />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {[["profile", "Profile"], ["accounts", "Accounts"], ["jarvis", "AI Coach"], ["privacy", "Privacy"], ["data", "Your data"]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-line px-3 py-1 text-ink-soft hover:border-line-strong hover:text-ink">{l}</a>
        ))}
      </nav>

      <div className="space-y-6">
        <Card id="profile" className="scroll-mt-20">
          <CardHeader title="Profile" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Display name" hint="Used to greet you">
              {(p) => <input {...p} className={inputClass} defaultValue={settings.displayName} maxLength={40} onBlur={(e) => e.target.value !== settings.displayName && void saveSettings({ displayName: e.target.value })} />}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-ink-soft">Theme</span>
              <Segmented label="Theme" value={settings.theme} onChange={(theme) => void saveSettings({ theme })} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
            </div>
          </div>
        </Card>

        <Accounts />

        <Card id="jarvis" className="scroll-mt-20">
          <CardHeader title="AI Coach" subtitle={<>Model and provider are chosen on the <Link href="/jarvis" className="text-accent underline">AI Coach</Link> page, under Model.</>} />
          <div className="divide-y divide-line px-5">
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
        </Card>

        <Privacy />
        <DataControls />
      </div>
    </>
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
    <Card id="accounts" className="scroll-mt-20">
      <CardHeader title="Trading accounts" subtitle={<>MetaTrader 5 connections are managed under <Link href="/accounts" className="text-accent underline">Accounts &amp; MT5</Link>.</>} />
      <ul className="divide-y divide-line">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.name} {a.isSample && <Badge tone="info">Sample</Badge>} {a.archived && <Badge>Archived</Badge>}</p>
              <p className="num text-[12.5px] text-muted">{a.currency}, starting {money(a.startingBalance, a.currency)}</p>
            </div>
            {settings?.defaultAccountId === a.id ? (
              <Badge tone="accent">Default</Badge>
            ) : (
              !a.archived && <Button size="sm" variant="ghost" onClick={() => void saveSettings({ defaultAccountId: a.id })}>Make default</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void archive(a.id, !a.archived)}>{a.archived ? "Restore" : "Archive"}</Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-[1fr_120px_160px_auto] sm:items-end">
        <Field label="New account name" error={errors.name}>{(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Currency" error={errors.currency}>{(p) => <input {...p} className={cx(inputClass, "uppercase")} value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value)} />}</Field>
        <Field label="Starting balance" error={errors.startingBalance}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />}</Field>
        <Button onClick={add} disabled={!name.trim()}>Add account</Button>
      </div>
    </Card>
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
    <Card id="privacy" className="scroll-mt-20">
      <CardHeader title="Privacy" subtitle="What the AI Coach can use, what is recorded, and what leaves this computer." />
      <div className="space-y-6 p-5">
        <section>
          <h3 className="text-[14px] font-semibold">Sharing with external AI providers</h3>
          <p className="mt-1 text-[13px] text-muted">Applies only when a provider such as Anthropic is active. Demo mode never sends anything.</p>
          <div role="radiogroup" aria-label="Sharing level" className="mt-3 grid gap-2 sm:grid-cols-3">
            {SHARING.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={j.sharing === s.value}
                onClick={() => void saveSettings({ jarvis: { sharing: s.value } })}
                className={cx("rounded-lg border p-3 text-left", j.sharing === s.value ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}
              >
                <span className="block text-[14px] font-medium">{s.label}</span>
                <span className="mt-1 block text-[12.5px] text-muted">{s.detail}</span>
              </button>
            ))}
          </div>
          {preview && (
            <div className="mt-3 rounded-lg border border-line bg-sunken p-3 text-[13px]">
              <p className="font-medium">
                Right now, a message would go to <span className="text-accent">{preview.provider}</span>
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

        <section className="divide-y divide-line border-t border-line">
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
            <h3 className="text-[14px] font-semibold">What activity recording captures</h3>
            <ul className="mt-2 grid gap-1 text-[13px] text-ink-soft sm:grid-cols-2">
              {Object.entries(activity.types).map(([k, v]) => (
                <li key={k}><code className="num text-[12px] text-muted">{k}</code>: {v}</li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">Jarvis does not record page views, clicks, keystrokes, time on page, or chat content.</p>
            <div className="mt-4 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold">Recorded events ({activity.events.length})</h3>
              <Button size="sm" variant="danger" disabled={!activity.events.length} onClick={async () => { await api("/api/activity", { method: "DELETE" }); await loadActivity(); }}>Delete log</Button>
            </div>
            {activity.events.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Nothing recorded.</p>
            ) : (
              <ul className="num mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-md border border-line text-[12.5px]">
                {activity.events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-3 py-1.5">
                    <span className="text-muted">{dateTime(e.createdAt)}</span>
                    <span>{e.type}</span>
                    <span className="truncate text-muted">{JSON.stringify(e.detail)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}

function DataControls() {
  const { refresh, toast } = useApp();
  const [confirmText, setConfirmText] = useState("");
  const hasSample = useFetch<Facets>("/api/facets").data?.hasSample;

  return (
    <Card id="data" className="scroll-mt-20">
      <CardHeader title="Your data" subtitle="Stored in a database file inside the app's data folder." />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/data" className="inline-flex h-9 items-center rounded-control border border-line-strong bg-raised px-3.5 text-sm font-medium hover:border-muted" download>
            Export everything (JSON)
          </a>
          {hasSample ? (
            <Button onClick={async () => { const r = await api<{ removed: number }>("/api/data/sample", { method: "DELETE" }); await refresh(); toast({ message: `Removed ${r.removed} sample trades.` }); }}>Remove sample data</Button>
          ) : (
            <Button onClick={async () => { const r = await api<{ added: number }>("/api/data/sample", { method: "POST" }); await refresh(); toast({ message: `Loaded ${r.added} sample trades.`, tone: "success" }); }}>Load sample data</Button>
          )}
        </div>
        <div className="rounded-lg border border-loss/40 p-4">
          <h3 className="text-[14px] font-semibold text-loss">Delete all data</h3>
          <p className="mt-1 text-[13px] text-muted">Permanently removes trades, accounts, attachments, settings, AI Coach conversations, memories and the activity log. Your sign-in stays. Export first if you want a copy.</p>
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
    </Card>
  );
}
