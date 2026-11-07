"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Analytics } from "@/lib/client/analytics";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateOnly, dateTime, fromLocalInput, money, pct, profitFactorText, rFmt, toLocalInput, toneOf, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { MAX_SESSION_BARS } from "@/lib/domain/backtest";
import { TIMEFRAME_SECONDS, type Bar, type BarMarker, type Timeframe } from "@/lib/domain/bars";
import type { Trade } from "@/lib/domain/types";
import { CandleChart, type PriceLine } from "@/components/charts/CandleChart";
import { Suspended } from "@/components/Suspended";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Notice, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

interface Session {
  id: number;
  accountId: number;
  name: string;
  symbol: string;
  timeframe: Timeframe;
  start: string;
  end: string;
  cursor: string;
  currency: string;
  startingBalance: number;
  strategy: string;
  source: "mt5" | "simulated";
  isSample: boolean;
  updatedAt: string;
  trades: number;
  open: number;
  netPnl: number;
}

interface View {
  session: Session;
  bars: Bar[];
  markers: BarMarker[];
  trades: Trade[];
  atEnd: boolean;
  reason: string | null;
}

const TIMEFRAMES: { value: Timeframe; label: string; bars: string }[] = [
  { value: "M1", label: "1 minute", bars: "1-minute" },
  { value: "M5", label: "5 minutes", bars: "5-minute" },
  { value: "M15", label: "15 minutes", bars: "15-minute" },
  { value: "H1", label: "1 hour", bars: "1-hour" },
];
const SPEEDS = [
  { value: "1", label: "1 bar/s" },
  { value: "3", label: "3 bars/s" },
  { value: "6", label: "6 bars/s" },
] as const;
type Speed = (typeof SPEEDS)[number]["value"];

const linkButton = "inline-flex h-9 items-center border border-line-strong px-3.5 text-sm font-medium hover:bg-raised max-sm:h-11";

export default function BacktestPage() {
  return (
    <Suspended>
      <Backtest />
    </Suspended>
  );
}

function Backtest() {
  const search = useSearchParams();
  const id = Number(search.get("session")) || null;
  return id ? <SessionPlayer id={id} /> : <Sessions />;
}

function Sessions() {
  const search = useSearchParams();
  const router = useRouter();
  const { toast } = useApp();
  const sample = search.get("includeSample") === "1";
  const { data, error, reload } = useFetch<{ sessions: Session[]; sampleHidden: boolean }>(`/api/backtests${sample ? "?includeSample=1" : ""}`);
  const [creating, setCreating] = useState(false);

  const remove = async (s: Session) => {
    if (!confirm(`Delete the backtest "${s.name}"? Its ${s.trades} ${s.trades === 1 ? "trade goes" : "trades go"} with it. This can't be undone.`)) return;
    try {
      await api(`/api/backtests/${s.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't delete it.", tone: "error" });
    }
  };

  return (
    <div>
      <PageHeader
        title="Backtesting"
        description="Trade a stretch of past prices bar by bar, without seeing what comes next. Results go through the same reports as your live trades, and never mix into them."
        actions={<Button variant="primary" className="max-sm:h-11" onClick={() => setCreating(true)}>New session</Button>}
      />
      {error && !data ? (
        <EmptyState title="Couldn't load your sessions" body={error} action={<Button onClick={reload}>Try again</Button>} />
      ) : !data ? (
        <Spinner label="Loading sessions" />
      ) : data.sessions.length === 0 ? (
        <EmptyState
          title="No backtests yet"
          body="Pick an instrument, a timeframe and a stretch of the past. Prices come from your connected MT5 broker."
          action={<span className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => setCreating(true)}>New session</Button>{data.sampleHidden && <Link href="/backtest?includeSample=1" className={linkButton}>See the sample session</Link>}</span>}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13.5px]" data-testid="backtest-sessions">
              <thead className="text-left text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-1.5 font-normal">Session</th>
                  <th scope="col" className="py-1.5 pl-3 font-normal">Instrument</th>
                  <th scope="col" className="py-1.5 pl-3 font-normal">Range</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-normal">Trades</th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-normal">Net P&amp;L</th>
                  <td />
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id} className="border-b border-line">
                    <th scope="row" className="py-1.5 text-left font-medium">
                      <Link href={`/backtest?session=${s.id}`} className="hover:underline">{s.name}</Link>
                      {s.isSample && <Badge tone="info" className="ml-2">Sample</Badge>}
                    </th>
                    <td className="py-1.5 pl-3 text-ink-soft">{s.symbol}, {TIMEFRAMES.find((t) => t.value === s.timeframe)?.label}</td>
                    <td className="num py-1.5 pl-3 text-ink-soft">{dateOnly(s.start)} to {dateOnly(s.end)}</td>
                    <td className="num py-1.5 pl-3 text-right">{s.trades}{s.open > 0 && <span className="text-info"> ({s.open} open)</span>}</td>
                    <td className={cx("num py-1.5 pl-3 text-right", toneOf(s.netPnl))}>{money(s.netPnl, s.currency, true)}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.sampleHidden && <p className="mt-3 text-[13px] text-muted">A sample session is hidden. <Link href="/backtest?includeSample=1" className="text-ink-soft underline underline-offset-2 hover:text-ink">Show it</Link></p>}
        </Card>
      )}
      <NewSession open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); router.push(`/backtest?session=${id}`); }} />
    </div>
  );
}

function NewSession({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { toast } = useApp();
  const { data: facets } = useFetch<{ symbols: string[]; strategies: string[] }>(open ? "/api/facets" : null);
  const blank = () => {
    const end = new Date(Date.now() - 86400000);
    end.setHours(0, 0, 0, 0);
    return { name: "", symbol: "", timeframe: "M15" as Timeframe, start: toLocalInput(new Date(end.getTime() - 7 * 86400000).toISOString()), end: toLocalInput(end.toISOString()), balance: "10000", strategy: "" };
  };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const span = (Date.parse(fromLocalInput(form.end) || "") - Date.parse(fromLocalInput(form.start) || "")) / 1000 / TIMEFRAME_SECONDS[form.timeframe];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { session } = await api<{ session: Session }>("/api/backtests", { method: "POST", json: { name: form.name, symbol: form.symbol, timeframe: form.timeframe, start: fromLocalInput(form.start), end: fromLocalInput(form.end), startingBalance: Number(form.balance), strategy: form.strategy } });
      setForm(blank());
      setErrors({});
      onCreated(session.id);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: err instanceof Error ? err.message : "Couldn't start the session.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New backtest" persistent>
      <form onSubmit={submit} className="grid grid-cols-2 gap-x-4 gap-y-3" noValidate>
        <Field label="Name" error={errors.name} className="col-span-2">{(p) => <input {...p} data-autofocus className={inputClass} maxLength={60} value={form.name} placeholder="Gold, London opens" onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Instrument" error={errors.symbol} hint="As your broker names it.">{(p) => <><input {...p} list="backtest-symbols" className={cx(inputClass, "uppercase")} maxLength={20} value={form.symbol} onChange={(e) => set("symbol", e.target.value)} /><datalist id="backtest-symbols">{facets?.symbols.map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
        <Field label="Timeframe" error={errors.timeframe}>{(p) => <select {...p} className={inputClass} value={form.timeframe} onChange={(e) => set("timeframe", e.target.value)}>{TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>}</Field>
        <Field label="From" error={errors.start}>{(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={form.start} onChange={(e) => set("start", e.target.value)} />}</Field>
        <Field label="To" error={errors.end}>{(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={form.end} onChange={(e) => set("end", e.target.value)} />}</Field>
        <p className={cx("col-span-2 -mt-1 text-[12.5px]", span > MAX_SESSION_BARS ? "text-loss" : "text-muted")} data-testid="bar-estimate">
          {Number.isFinite(span) && span > 0 ? `About ${Math.round(span).toLocaleString("en-US")} bars, weekends included. Up to ${MAX_SESSION_BARS.toLocaleString("en-US")}.` : `Times are ${zoneName()}.`}
        </p>
        <Field label="Starting balance" error={errors.startingBalance}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.balance} onChange={(e) => set("balance", e.target.value)} />}</Field>
        <Field label="Playbook" error={errors.strategy} hint="Optional. Its trades are tagged with it.">{(p) => <><input {...p} list="backtest-playbooks" className={inputClass} maxLength={60} value={form.strategy} onChange={(e) => set("strategy", e.target.value)} /><datalist id="backtest-playbooks">{facets?.strategies.map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
        <div className="col-span-2 flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Reading prices…" : "Start session"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function SessionPlayer({ id }: { id: number }) {
  const { openTrade, toast } = useApp();
  const { data, error, reload } = useFetch<View>(`/api/backtests/${id}`);
  const stats = useFetch<Analytics>(data ? `/api/analytics?accountId=${data.session.accountId}` : null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const move = async (bars: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await api(`/api/backtests/${id}/step`, { method: "POST", json: { bars } });
      reload();
      stats.reload();
    } catch (e) {
      setPlaying(false);
      toast({ message: e instanceof Error ? e.message : "Couldn't move on.", tone: "error" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Plays by asking the server for one bar at a time: the page never holds a bar before it's reached.
  useEffect(() => {
    if (!playing || !data || data.atEnd || busy) return;
    const timer = setTimeout(() => void move(1), 1000 / Number(speed));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, data, speed, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector("dialog[open]")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        void move(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useMemo(() => (data?.trades ?? []).filter((t) => t.status !== "closed"), [data]);
  const closed = useMemo(() => (data?.trades ?? []).filter((t) => t.status === "closed").sort((a, b) => Date.parse(b.closedAt ?? "") - Date.parse(a.closedAt ?? "")), [data]);
  const lines = useMemo<PriceLine[]>(() => open.flatMap((t) => [
    ...(t.stopPrice === null ? [] : [{ price: t.stopPrice, label: `Stop #${t.id}`, tone: "loss" as const }]),
    ...(t.targetPrice === null ? [] : [{ price: t.targetPrice, label: `Target #${t.id}`, tone: "profit" as const }]),
  ]), [open]);

  if (error && !data) return <EmptyState title="Couldn't load this session" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading the session" />;
  const s = data.session;
  const last = data.bars.at(-1);
  const sample = s.isSample ? "&includeSample=1" : "";
  const m = stats.data?.metrics;

  return (
    <div>
      <PageHeader
        title={s.name}
        description={`${s.symbol}, ${TIMEFRAMES.find((t) => t.value === s.timeframe)?.bars} bars, ${dateOnly(s.start)} to ${dateOnly(s.end)}. Times are ${zoneName()}.`}
        actions={<>
          <Link href={`/analytics?accountId=${s.accountId}`} className={linkButton}>Full report</Link>
          <Link href={`/analytics?tab=compare&a.accountId=${s.accountId}&b.symbol=${encodeURIComponent(s.symbol)}`} className={linkButton}>Compare with live</Link>
          <Link href={`/backtest${s.isSample ? "?includeSample=1" : ""}`} className="inline-flex h-9 items-center px-2 text-[13.5px] text-ink-soft underline underline-offset-2 max-sm:h-11">All sessions</Link>
        </>}
      />
      {s.source === "simulated" && <Notice tone="info">Sample session on made-up prices, to show how backtesting works. Its results aren&apos;t real.</Notice>}
      {data.reason ? (
        <EmptyState title="Prices can't be read just now" body={<span data-testid="no-prices">{data.reason}</span>} action={<Button onClick={reload}>Try again</Button>} />
      ) : (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            <CandleChart bars={data.bars} markers={data.markers} lines={lines} height={400} label={`${s.symbol} price, up to the session's current bar`} />
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
              {s.source === "simulated" ? <Badge tone="info">Simulated</Badge> : <span>Your MT5 broker&apos;s bid prices.</span>}
              <span>Orders fill at the bar&apos;s close. A stop or target fills at its level, or at the open when price gaps past it. With both in one bar, the stop is taken.</span>
            </p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Session controls">
              <Button size="sm" className="max-sm:h-11" disabled={busy || data.atEnd} onClick={() => { setPlaying(false); void move(1); }}>Next bar</Button>
              <Button size="sm" className="max-sm:h-11" disabled={busy || data.atEnd} onClick={() => { setPlaying(false); void move(10); }}>10 bars</Button>
              <Button size="sm" variant="primary" className="w-20 max-sm:h-11" disabled={data.atEnd} onClick={() => setPlaying((p) => !p)}>{playing && !data.atEnd ? "Pause" : "Play"}</Button>
              <Segmented label="Play speed" value={speed} onChange={setSpeed} options={[...SPEEDS]} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-line py-2 text-[13px] sm:grid-cols-4">
              <div><dt className="text-muted">Bar</dt><dd className="num text-ink" data-testid="bt-clock">{last ? dateTime(new Date(last.t * 1000).toISOString()) : "—"}</dd></div>
              <div><dt className="text-muted">Last price</dt><dd className="num text-ink" data-testid="bt-price">{last?.c ?? "—"}</dd></div>
              <div><dt className="text-muted">Ends</dt><dd className="num text-ink">{dateTime(s.end)}</dd></div>
              <div><dt className="text-muted">Status</dt><dd className="text-ink" data-testid="bt-status">{data.atEnd ? "Reached the end" : Date.parse(s.cursor) < Date.parse(s.start) ? "Warm-up, before the start" : "Running"}</dd></div>
            </dl>
            <p className="hidden text-[12.5px] text-muted md:block"><kbd>Space</kbd> plays and pauses, <kbd>Right</kbd> moves a bar. There&apos;s no going back: a backtest only moves forward.</p>

            <Positions trades={open} price={last?.c ?? null} currency={s.currency} sessionId={id} atEnd={data.atEnd} onChanged={() => { reload(); stats.reload(); }} />

            <section aria-label="Closed trades">
              <h2 className="text-[14px] font-medium text-ink">Closed trades</h2>
              {closed.length === 0 ? (
                <p className="mt-1 text-[13px] text-muted">None yet.</p>
              ) : (
                <ol className="mt-1 divide-y divide-line border-y border-line text-[13px]" data-testid="bt-closed">
                  {closed.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
                      <button type="button" className="font-medium hover:underline" onClick={() => openTrade(t.id)}>#{t.id}</button>
                      <span className="capitalize text-ink-soft">{t.side}</span>
                      <span className="num text-ink-soft">{t.quantity} at {t.entryPrice} to {t.exitPrice}</span>
                      <span className="text-muted">{t.exitReason}</span>
                      <span className={cx("num ml-auto", toneOf(t.pnl))}>{money(t.pnl, s.currency, true)}</span>
                      <span className="num w-14 text-right text-ink-soft">{rFmt(t.rMultiple)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="min-w-0 space-y-6">
            <OrderTicket sessionId={id} price={last?.c ?? null} disabled={data.atEnd} onPlaced={() => { reload(); stats.reload(); }} />
            <Card>
              <CardHeader title="This session" subtitle={`Starting balance ${money(s.startingBalance, s.currency)}.`} />
              {!m ? (
                <Spinner label="Working it out" />
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]" data-testid="bt-stats">
                  <div><dt className="text-muted">Net P&amp;L</dt><dd className={cx("num text-[15px]", toneOf(m.netPnl))}>{money(m.netPnl, s.currency, true)}</dd></div>
                  <div><dt className="text-muted">Closed trades</dt><dd className="num text-[15px]">{m.closedTrades}</dd></div>
                  <div><dt className="text-muted">Win rate</dt><dd className="num">{pct(m.winRate)}</dd></div>
                  <div><dt className="text-muted">Profit factor</dt><dd className="num">{profitFactorText(m)}</dd></div>
                  <div><dt className="text-muted">Average R</dt><dd className="num">{rFmt(m.avgR)}</dd></div>
                  <div><dt className="text-muted">Max drawdown</dt><dd className="num">{money(-m.maxDrawdown, s.currency)}</dd></div>
                </dl>
              )}
              <p className="mt-3 text-[12.5px] text-muted">Costs use your fee defaults from Settings. <Link href={`/journal?accountId=${s.accountId}${sample}`} className="text-ink-soft underline underline-offset-2 hover:text-ink">Open its trades in the journal</Link> to tag and review them.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderTicket({ sessionId, price, disabled, onPlaced }: { sessionId: number; price: number | null; disabled: boolean; onPlaced: () => void }) {
  const { toast } = useApp();
  const [side, setSide] = useState<"long" | "short">("long");
  const [form, setForm] = useState({ quantity: "1", stop: "", target: "", note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [stop, target] = [num(form.stop), num(form.target)];
  const risk = price !== null && stop !== null ? Math.abs(price - stop) : null;
  const planned = risk && target !== null && price !== null ? Math.abs(target - price) / risk : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/backtests/${sessionId}/orders`, { method: "POST", json: { side, quantity: Number(form.quantity), stopPrice: stop, targetPrice: target, note: form.note } });
      setForm((f) => ({ ...f, stop: "", target: "", note: "" }));
      setErrors({});
      onPlaced();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: err instanceof Error ? err.message : "Couldn't place it.", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="New trade" subtitle={price === null ? undefined : <>Fills at the last price, <span className="num">{price}</span>.</>} />
      <form onSubmit={submit} className="grid grid-cols-2 gap-x-3 gap-y-3" noValidate aria-label="Order ticket">
        <div className="col-span-2"><Segmented label="Direction" value={side} onChange={setSide} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} /></div>
        <Field label="Size" error={errors.quantity} hint="Lots or units, as for your broker." className="col-span-2">{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />}</Field>
        <Field label="Stop" error={errors.stopPrice}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.stop} onChange={(e) => set("stop", e.target.value)} />}</Field>
        <Field label="Target" error={errors.targetPrice}>{(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.target} onChange={(e) => set("target", e.target.value)} />}</Field>
        <p className="col-span-2 -mt-1 text-[12.5px] text-muted" data-testid="bt-plan">{risk !== null ? <>Risk <span className="num">{Number(risk.toPrecision(6))}</span> a unit{planned !== null && <>, target <span className="num">{planned.toFixed(2)}R</span></>}.</> : "Without a stop, R can't be worked out."}</p>
        <Field label="Why" error={errors.note} className="col-span-2">{(p) => <input {...p} className={inputClass} maxLength={2000} value={form.note} placeholder="Optional" onChange={(e) => set("note", e.target.value)} />}</Field>
        <Button type="submit" variant="primary" className="col-span-2 max-sm:h-11" disabled={busy || disabled || price === null}>{side === "long" ? "Buy" : "Sell"}{price !== null && <> at <span className="num">{price}</span></>}</Button>
        {disabled && <p className="col-span-2 text-[12.5px] text-muted">The session has reached its end.</p>}
      </form>
    </Card>
  );
}

function Positions({ trades, price, currency, sessionId, atEnd, onChanged }: { trades: Trade[]; price: number | null; currency: string; sessionId: number; atEnd: boolean; onChanged: () => void }) {
  const { toast, openTrade } = useApp();
  const close = async (t: Trade) => {
    try {
      await api(`/api/backtests/${sessionId}/close`, { method: "POST", json: { tradeId: t.id } });
      onChanged();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't close it.", tone: "error" });
    }
  };
  return (
    <section aria-label="Open positions">
      <h2 className="text-[14px] font-medium text-ink">Open positions</h2>
      {trades.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted">Flat.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line border-y border-line text-[13px]" data-testid="bt-open">
          {trades.map((t) => {
            const open = price === null ? null : (price - t.entryPrice) * (t.side === "long" ? 1 : -1) * t.quantity * t.multiplier * (t.fxRate ?? 1);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1">
                <button type="button" className="font-medium hover:underline" onClick={() => openTrade(t.id)}>#{t.id}</button>
                <span className="text-ink-soft"><span className="capitalize">{t.side}</span> <span className="num">{t.quantity}</span> at <span className="num">{t.entryPrice}</span></span>
                <span className="num text-muted">stop {t.stopPrice ?? "none"}, target {t.targetPrice ?? "none"}</span>
                <span className={cx("num ml-auto", toneOf(open))} title="Before costs">{money(open, currency, true)}</span>
                <Button size="sm" className="max-sm:h-11" disabled={price === null} onClick={() => void close(t)}>Close{atEnd ? " at the end" : ""}</Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
