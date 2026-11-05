"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { dateTime, money, toneOf } from "@/lib/client/format";
import { Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Spinner, inputClass } from "@/components/ui";
import type { ConnectionStatus } from "@/lib/server/repo/mt5";

interface PlainAccount {
  id: number;
  name: string;
  broker: string;
  currency: string;
  source: string;
  archived: boolean;
}

interface Position {
  broker_position_id: string;
  symbol: string;
  side: string;
  volume: number;
  price_open: number;
  price_current: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  swap: number | null;
  profit: number | null;
  opened_at: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

function age(seconds: number | null) {
  if (seconds === null) return "never";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

function StateBadge({ c }: { c: ConnectionStatus }) {
  if (c.state === "syncing") return <Badge tone="info">Syncing</Badge>;
  if (c.state === "disconnected") return <Badge>Disconnected</Badge>;
  if (c.state === "error" || c.state === "auth_failed") return <Badge tone="loss">Error</Badge>;
  if (c.stale) return <Badge tone="accent">Stale</Badge>;
  return <Badge tone="profit">Connected</Badge>;
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`num text-[15px] font-medium ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [login, setLogin] = useState("");
  const [server, setServer] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssues({});
    try {
      await api("/api/mt5/connect", { method: "POST", json: { login, server, password } });
      setLogin("");
      setServer("");
      onConnected();
    } catch (err) {
      setIssues(fieldErrors(err));
      setError(message(err));
    } finally {
      setPassword(""); // Never kept in the page after an attempt.
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Connect an MT5 account" subtitle="Read-only. Jarvis can't place, change or close trades." />
      <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Field label="Account number" error={issues.login}>
          {(p) => <input {...p} className={inputClass} inputMode="numeric" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} required />}
        </Field>
        <Field label="Server" error={issues.server} hint="Exactly as MT5 shows it, such as Broker-Live01">
          {(p) => <input {...p} className={inputClass} autoComplete="off" value={server} onChange={(e) => setServer(e.target.value)} required />}
        </Field>
        <Field label="Investor password" error={issues.password} hint="Not your main password">
          {(p) => <input {...p} className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <div className="sm:col-span-3">
          <p className="text-[13px] text-muted">
            Use the investor password: it can only read, so nothing here can trade even if something goes wrong. It is stored encrypted on this computer and never shown again. Jarvis logs in through its own separate MT5 terminal, so a terminal you have open stays as it is.
          </p>
          {error && <p role="alert" className="mt-2 text-[13px] text-loss">{error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Connecting" : "Connect"}</Button>
            {busy && <Spinner label="Starting the terminal and logging in. The first time can take a few minutes." />}
          </div>
        </div>
      </form>
    </Card>
  );
}

function PositionsTable({ accountId, currency, syncKey }: { accountId: number; currency: string; syncKey: string | null }) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<{ positions: Position[] }>(`/api/mt5/positions?accountId=${accountId}`)
      .then((r) => live && (setPositions(r.positions), setError(null)))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [accountId, syncKey]);

  if (error) return <p className="px-5 py-3 text-[13px] text-loss">{error}</p>;
  if (!positions) return <div className="px-5 py-3"><Spinner /></div>;
  if (positions.length === 0) return <p className="px-5 py-3 text-[13px] text-muted">No open positions at the last sync.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="text-left text-[12px] text-muted">
          <tr>{["Symbol", "Side", "Lots", "Open", "Last price", "Stop", "Target", "Swap", "Floating P&L", "Opened"].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="num">
          {positions.map((p) => (
            <tr key={p.broker_position_id} className="border-t border-line">
              <td className="px-5 py-2 text-ink">{p.symbol}</td>
              <td className="px-5 py-2">{p.side}</td>
              <td className="px-5 py-2">{p.volume}</td>
              <td className="px-5 py-2">{p.price_open}</td>
              <td className="px-5 py-2">{p.price_current ?? "—"}</td>
              <td className="px-5 py-2">{p.stop_loss ?? "—"}</td>
              <td className="px-5 py-2">{p.take_profit ?? "—"}</td>
              <td className="px-5 py-2">{money(p.swap, currency)}</td>
              <td className={`px-5 py-2 ${toneOf(p.profit)}`}>{money(p.profit, currency, true)}</td>
              <td className="px-5 py-2">{dateTime(p.opened_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionCard({ c, onChange }: { c: ConnectionStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalValue] = useState(String(c.intervalSeconds));
  const currency = c.currency ?? "USD";
  const connected = c.state !== "disconnected";
  // Without a snapshot there is nothing to show, and a blank is more honest than a zero.
  const v = (n: number | null) => money(n, currency);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      onChange();
    }
  }

  return (
    <Card>
      <CardHeader
        title={c.accountName}
        subtitle={`${c.login} on ${c.server}`}
        action={<StateBadge c={c} />}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-soft">
          <span>Last successful sync: <span className="text-ink">{dateTime(c.lastSuccessAt)}</span></span>
          <span>Data age: <span className={c.stale ? "text-loss" : "text-ink"}>{age(c.dataAgeSeconds)}</span></span>
          {!c.syncEnabled && connected && <span>Automatic sync is off</span>}
        </div>
        {c.stale && connected && c.lastSuccessAt && (
          <p className="text-[13px] text-loss">These figures are from the last successful sync and may be out of date.</p>
        )}
        {c.lastError && <p role="alert" className="text-[13px] text-loss">{c.lastError}</p>}
        {error && <p role="alert" className="text-[13px] text-loss">{error}</p>}
        {c.masterPasswordWarning && connected && (
          <p role="alert" className="rounded-md border border-loss/50 px-3 py-2 text-[13px] text-loss">
            This login is allowed to trade, which suggests it is your main password rather than the investor password. Jarvis never trades, but it would be safer to disconnect and reconnect with the investor password.
          </p>
        )}
        {c.syncNote && <p className="text-[13px] text-muted">{c.syncNote}</p>}

        {connected && c.snapshotAt && (
          <div className={`grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8 ${c.stale ? "opacity-60" : ""}`}>
            <Figure label="Balance" value={v(c.balance)} />
            <Figure label="Equity" value={v(c.equity)} />
            <Figure label="Margin" value={v(c.margin)} />
            <Figure label="Free margin" value={v(c.marginFree)} />
            <Figure label="Margin level" value={c.marginLevel ? `${c.marginLevel.toFixed(0)}%` : "—"} />
            <Figure label="Leverage" value={c.leverage ? `1:${c.leverage}` : "—"} />
            <Figure label="Currency" value={c.currency ?? "—"} />
            <Figure label="Floating P&L" value={money(c.floatingPnl, currency, true)} tone={toneOf(c.floatingPnl)} />
          </div>
        )}

        {connected && (
          <div className="flex flex-wrap items-end gap-3">
            <Button size="sm" disabled={busy || c.state === "syncing"} onClick={() => run(() => api("/api/mt5/sync", { method: "POST", json: { accountId: c.accountId } }))}>Sync now</Button>
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              Every
              <input className={`${inputClass} !h-8 !w-20`} type="number" min={30} max={86400} value={interval} onChange={(e) => setIntervalValue(e.target.value)} aria-label="Sync interval in seconds" />
              seconds
            </label>
            <Button size="sm" variant="ghost" disabled={busy || Number(interval) === c.intervalSeconds} onClick={() => run(() => api("/api/mt5/settings", { method: "PATCH", json: { accountId: c.accountId, intervalSeconds: Number(interval) } }))}>Save</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api("/api/mt5/settings", { method: "PATCH", json: { accountId: c.accountId, enabled: !c.syncEnabled } }))}>{c.syncEnabled ? "Pause sync" : "Resume sync"}</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => confirm("Disconnect? The stored password is deleted. Your trades and notes stay.") && run(() => api("/api/mt5/disconnect", { method: "POST", json: { accountId: c.accountId } }))}>Disconnect</Button>
          </div>
        )}
        {!connected && <p className="text-[13px] text-muted">The stored password was deleted. Past trades stay in your journal. Connect again with the same account number and server to resume.</p>}
      </div>
      {connected && c.snapshotAt && (
        <div className="border-t border-line">
          <h3 className="px-5 pt-3 text-[13px] font-medium text-ink-soft">Open positions</h3>
          <PositionsTable accountId={c.accountId} currency={currency} syncKey={c.lastSuccessAt} />
        </div>
      )}
    </Card>
  );
}

export function AccountsPage() {
  const [connections, setConnections] = useState<ConnectionStatus[] | null>(null);
  const [accounts, setAccounts] = useState<PlainAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api<{ connections: ConnectionStatus[] }>("/api/mt5/status"), api<{ accounts: PlainAccount[] }>("/api/accounts")]);
      setConnections(s.connections);
      setAccounts(a.accounts);
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const linked = new Set(connections?.map((c) => c.accountId));
  const others = accounts.filter((a) => !linked.has(a.id));

  return (
    <>
      <PageHeader title="Accounts" description="Your trading accounts and their read-only MT5 connections." />
      {error && <p role="alert" className="mb-4 text-[13px] text-loss">{error}</p>}
      {!connections && !error && <Spinner />}
      <div className="space-y-5">
        {connections?.map((c) => <ConnectionCard key={c.accountId} c={c} onChange={load} />)}
        {connections?.length === 0 && <EmptyState title="No MT5 account connected" body="Connect one below to bring in its trades, balance and open positions automatically." />}
        {connections && <ConnectForm onConnected={load} />}
        {others.length > 0 && (
          <Card>
            <CardHeader title="Other accounts" subtitle="Filled in by hand or by file import." />
            <ul className="divide-y divide-line text-[13.5px]">
              {others.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0 truncate text-ink">{a.name}{a.broker ? ` · ${a.broker}` : ""}</span>
                  <span className="flex items-center gap-2 text-muted">{a.archived && <Badge>Archived</Badge>}{a.currency}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
