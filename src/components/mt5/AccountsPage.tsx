"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { dateTime, money, toneOf, zoneName } from "@/lib/client/format";
import { Badge, Button, EmptyState, Field, Notice, PageHeader, Spinner, cx, inputClass } from "@/components/ui";
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

function StateWords({ c }: { c: ConnectionStatus }) {
  if (c.state === "syncing") return <Badge tone="info">Syncing</Badge>;
  if (c.state === "disconnected") return <Badge>Disconnected</Badge>;
  if (c.state === "error" || c.state === "auth_failed") return <Badge tone="loss">Error</Badge>;
  if (c.stale) return <Badge tone="warn">Stale</Badge>;
  return <Badge>Connected</Badge>;
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 border-t border-line py-1.5 pr-3">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={cx("num text-[15px]", tone ?? "text-ink")}>{value}</dd>
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
    <section className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-3 border-t border-line py-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-[15px] font-medium text-ink">Connect an MT5 account</h2>
        <p className="mt-0.5 text-[13px] text-muted">Read-only. Jarvis can&apos;t place, change or close trades.</p>
      </div>
      <form onSubmit={submit} className="grid min-w-0 gap-3 sm:grid-cols-3">
        <Field label="Account number" error={issues.login}>
          {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="numeric" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} required />}
        </Field>
        <Field label="Server" error={issues.server} hint="Exactly as MT5 shows it, such as Broker-Live01">
          {(p) => <input {...p} className={inputClass} autoComplete="off" value={server} onChange={(e) => setServer(e.target.value)} required />}
        </Field>
        <Field label="Investor password" error={issues.password} hint="Not your main password">
          {(p) => <input {...p} className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <div className="sm:col-span-3">
          <p className="max-w-3xl text-[13px] text-muted">
            Use the investor password: it can only read, so nothing here can trade even if something goes wrong. It is stored encrypted on this computer and never shown again. Jarvis logs in through its own separate MT5 terminal, so a terminal you have open stays as it is.
          </p>
          {error && <p role="alert" className="mt-2 border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Connecting" : "Connect"}</Button>
            {busy && <Spinner label="Starting the terminal and logging in. The first time can take a few minutes." />}
          </div>
        </div>
      </form>
    </section>
  );
}

const POSITION_HEADS: [string, boolean][] = [["Symbol", false], ["Side", false], ["Lots", true], ["Open", true], ["Last price", true], ["Stop", true], ["Target", true], ["Swap", true], ["Floating P&L", true], ["Opened", true]];

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

  if (error) return <p className="text-[13px] text-loss">{error}</p>;
  if (!positions) return <Spinner label="Loading open positions" />;
  if (positions.length === 0) return <p className="text-[13px] text-muted">No open positions at the last sync.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="text-left text-[12.5px] text-muted">
          <tr className="border-b border-line">
            {POSITION_HEADS.map(([h, right], i) => <th key={h} scope="col" className={cx("py-1.5 pr-3 font-normal whitespace-nowrap", right && "text-right", i === 0 && "sticky left-0 bg-canvas")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.broker_position_id} className="border-b border-line">
              <td className="sticky left-0 bg-canvas py-1.5 pr-3 text-ink">{p.symbol}</td>
              <td className="py-1.5 pr-3 capitalize">{p.side}</td>
              <td className="num py-1.5 pr-3 text-right">{p.volume}</td>
              <td className="num py-1.5 pr-3 text-right">{p.price_open}</td>
              <td className="num py-1.5 pr-3 text-right">{p.price_current ?? "—"}</td>
              <td className="num py-1.5 pr-3 text-right">{p.stop_loss ?? "—"}</td>
              <td className="num py-1.5 pr-3 text-right">{p.take_profit ?? "—"}</td>
              <td className="num py-1.5 pr-3 text-right">{money(p.swap, currency)}</td>
              <td className={cx("num py-1.5 pr-3 text-right", toneOf(p.profit))}>{money(p.profit, currency, true)}</td>
              <td className="num py-1.5 text-right whitespace-nowrap">{dateTime(p.opened_at)}</td>
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
    <section className="border-t border-line py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium text-ink">{c.accountName}</h2>
          <p className="text-[13px] text-muted"><span className="num">{c.login}</span> on {c.server}</p>
        </div>
        <StateWords c={c} />
      </div>
      <div className="mt-3 space-y-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <div className="flex gap-1.5"><dt className="text-muted">Last successful sync, {zoneName()}</dt><dd className="num text-ink">{dateTime(c.lastSuccessAt)}</dd></div>
          <div className="flex gap-1.5"><dt className="text-muted">Data age</dt><dd className={cx("num", c.stale ? "font-medium text-warn" : "text-ink")}>{age(c.dataAgeSeconds)}</dd></div>
          {!c.syncEnabled && connected && <div className="text-ink-soft">Automatic sync is off</div>}
        </dl>
        {c.stale && connected && c.lastSuccessAt && <Notice>These figures are from the last successful sync and may be out of date.</Notice>}
        {c.lastError && <p role="alert" className="border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">{c.lastError}</p>}
        {error && <p role="alert" className="border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">{error}</p>}
        {c.masterPasswordWarning && connected && (
          <p role="alert" className="border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">
            This login is allowed to trade, which suggests it is your main password rather than the investor password. Jarvis never trades, but it would be safer to disconnect and reconnect with the investor password.
          </p>
        )}
        {c.syncNote && <p className="text-[13px] text-muted">{c.syncNote}</p>}

        {connected && c.snapshotAt && (
          <dl className={cx("grid grid-cols-2 sm:grid-cols-4", c.stale && "opacity-60")}>
            <Figure label="Balance" value={v(c.balance)} />
            <Figure label="Equity" value={v(c.equity)} />
            <Figure label="Margin" value={v(c.margin)} />
            <Figure label="Free margin" value={v(c.marginFree)} />
            <Figure label="Margin level" value={c.marginLevel ? `${c.marginLevel.toFixed(0)}%` : "—"} />
            <Figure label="Leverage" value={c.leverage ? `1:${c.leverage}` : "—"} />
            <Figure label="Currency" value={c.currency ?? "—"} />
            <Figure label="Floating P&L" value={money(c.floatingPnl, currency, true)} tone={toneOf(c.floatingPnl)} />
          </dl>
        )}

        {connected && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy || c.state === "syncing"} onClick={() => run(() => api("/api/mt5/sync", { method: "POST", json: { accountId: c.accountId } }))}>Sync now</Button>
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              Every
              <input className={cx(inputClass, "num !h-8 !w-20")} type="number" min={30} max={86400} value={interval} onChange={(e) => setIntervalValue(e.target.value)} aria-label="Sync interval in seconds" />
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
        <div className="mt-4">
          <h3 className="pb-1 text-[13px] font-medium text-ink-soft">Open positions</h3>
          <PositionsTable accountId={c.accountId} currency={currency} syncKey={c.lastSuccessAt} />
        </div>
      )}
    </section>
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
      {error && <p role="alert" className="mb-4 border-l-2 border-loss bg-loss-soft px-3 py-2 text-[13px]">{error}</p>}
      {!connections && !error && <Spinner label="Reading your connections" />}
      {connections?.map((c) => <ConnectionCard key={c.accountId} c={c} onChange={load} />)}
      {connections?.length === 0 && <EmptyState title="No MT5 account connected" body="Connect one below to bring in its trades, balance and open positions automatically." />}
      {connections && <ConnectForm onConnected={load} />}
      {others.length > 0 && (
        <section className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-3 border-t border-line py-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div>
            <h2 className="text-[15px] font-medium text-ink">Other accounts</h2>
            <p className="mt-0.5 text-[13px] text-muted">Filled in by hand or by file import.</p>
          </div>
          <ul className="min-w-0 divide-y divide-line border-y border-line text-[13.5px]">
            {others.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-ink">{a.name}{a.broker ? `, ${a.broker}` : ""}</span>
                <span className="flex items-center gap-2 text-muted">{a.archived && <Badge>Archived</Badge>}<span className="num">{a.currency}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
