"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/client/app-state";
import { dateTime, money, timeOnly, toneOf, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { replayPnl } from "@/lib/domain/metrics";
import type { Trade } from "@/lib/domain/types";
import { CandleChart, type PriceLine } from "@/components/charts/CandleChart";
import { sourceNote, type TradeBarsResponse } from "@/components/charts/TradePriceChart";
import { LinkedNotes } from "@/components/notebook/LinkedNotes";
import { Suspended } from "@/components/Suspended";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

export default function ReplayPage() {
  return (
    <Suspended>
      <Replay />
    </Suspended>
  );
}

type DayResponse = Omit<TradeBarsResponse, "trade"> & { symbols: string[]; symbol: string | null; trades: { id: number; side: string; grossPnl: number | null }[] };

const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "2", label: "2x" },
  { value: "5", label: "5x" },
  { value: "10", label: "10x" },
] as const;
type Speed = (typeof SPEEDS)[number]["value"];
const LEAD_BARS = 10;

function Replay() {
  const search = useSearchParams();
  const tradeId = Number(search.get("trade")) || null;
  const day = search.get("day");
  const sample = search.get("includeSample") === "1";
  if (tradeId) return <TradeReplay id={tradeId} sample={sample} />;
  if (day) return <DayReplay day={day} sample={sample} />;
  return <Chooser sample={sample} />;
}

function Chooser({ sample }: { sample: boolean }) {
  const router = useRouter();
  const { openTrade } = useApp();
  const q = sample ? "&includeSample=1" : "";
  const { data } = useFetch<{ trades: Trade[] }>(`/api/trades?closedOnly=1&sort=closedAt&pageSize=15${q}`);
  return (
    <div>
      <PageHeader title="Replay" description="Walk through a trade or a whole day bar by bar, as it unfolded. Prices come from your connected MT5 account." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Replay a day" />
          <label className="flex max-w-xs flex-col gap-1 text-[13px] text-ink-soft">
            Date
            <input type="date" aria-label="Day to replay" className={cx(inputClass, "num text-[13px]")} onChange={(e) => e.target.value && router.push(`/replay?day=${e.target.value}${q}`)} />
          </label>
        </Card>
        <Card>
          <CardHeader title="Replay a trade" subtitle="Your latest closed trades." />
          {data?.trades.length ? (
            <ul className="divide-y divide-line border-y border-line text-[13.5px]" data-testid="replay-trades">
              {data.trades.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-1">
                  <Link href={`/replay?trade=${t.id}${q}`} className="min-h-8 font-medium leading-8 hover:underline max-sm:min-h-11">{t.symbol}</Link>
                  <span className="text-ink-soft capitalize">{t.side}</span>
                  <span className="num text-[12.5px] text-muted">{dateTime(t.closedAt)}</span>
                  <button type="button" className="ml-auto text-[12.5px] text-muted underline underline-offset-2 hover:text-ink" onClick={() => openTrade(t.id)}>Details</button>
                </li>
              ))}
            </ul>
          ) : data ? (
            <p className="text-[13.5px] text-muted">No closed trades yet.</p>
          ) : (
            <Spinner label="Loading your trades" />
          )}
        </Card>
      </div>
    </div>
  );
}

function TradeReplay({ id, sample }: { id: number; sample: boolean }) {
  const { openTrade, accounts } = useApp();
  const { data, error, reload } = useFetch<TradeBarsResponse>(`/api/trades/${id}/bars`);
  const lines = useMemo<PriceLine[]>(() => {
    if (!data) return [];
    return [
      ...(data.trade.stopPrice === null ? [] : [{ price: data.trade.stopPrice, label: "Stop", tone: "loss" as const }]),
      ...(data.trade.targetPrice === null ? [] : [{ price: data.trade.targetPrice, label: "Target", tone: "profit" as const }]),
    ];
  }, [data]);
  if (error && !data) return <EmptyState title="Couldn't load this trade" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading prices" />;
  const currency = accounts.find((a) => a.id === data.trade.accountId)?.currency;
  return (
    <div>
      <PageHeader title={`Replay: ${data.trade.symbol} ${data.trade.side}`} description={`Trade #${id}. Times are ${zoneName()}.`} actions={<><Button className="max-sm:h-11" onClick={() => openTrade(id)}>Trade details</Button><Link href={`/replay${sample ? "?includeSample=1" : ""}`} className="inline-flex h-9 items-center px-2 text-[13.5px] text-ink-soft underline underline-offset-2 max-sm:h-11">Pick another</Link></>} />
      {data.bars.length === 0 ? (
        <EmptyState title="No prices to replay" body={<span data-testid="no-prices">{data.reason}</span>} />
      ) : (
        <Player data={data} lines={lines} currency={currency} label={`${data.trade.symbol} price, replayed`} key={id} />
      )}
      <div className="mt-6"><LinkedNotes tradeId={id} title={`${data.trade.symbol}, trade #${id}`} sample={sample || data.source === "simulated"} /></div>
    </div>
  );
}

function DayReplay({ day, sample }: { day: string; sample: boolean }) {
  const search = useSearchParams();
  const router = useRouter();
  const { accounts } = useApp();
  const symbol = search.get("symbol") ?? "";
  const { data, error, reload } = useFetch<DayResponse>(`/api/replay/day?date=${encodeURIComponent(day)}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}${sample ? "&includeSample=1" : ""}`);
  if (error && !data) return <EmptyState title="Couldn't load this day" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading the day" />;
  const currency = accounts[0]?.currency;
  return (
    <div>
      <PageHeader title={`Replay: ${day}`} description={`Trades opened this day, one instrument at a time. Times are ${zoneName()}.`} actions={<><Link href={`/day?date=${day}${sample ? "&includeSample=1" : ""}`} className="inline-flex h-9 items-center border border-line-strong px-3.5 text-sm font-medium hover:bg-raised max-sm:h-11">Open the daily journal</Link><Link href={`/replay${sample ? "?includeSample=1" : ""}`} className="inline-flex h-9 items-center px-2 text-[13.5px] text-ink-soft underline underline-offset-2 max-sm:h-11">Pick another</Link></>} />
      {data.symbols.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-[13px] text-ink-soft">
          Instrument
          <select aria-label="Instrument" className="h-8 border border-line-strong bg-transparent px-2 text-[13px] text-ink max-sm:h-11" value={data.symbol ?? ""} onChange={(e) => { const n = new URLSearchParams(search.toString()); n.set("symbol", e.target.value); router.push(`/replay?${n}`, { scroll: false }); }}>
            {data.symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {data.bars.length === 0 ? (
        <EmptyState title="Nothing to replay" body={<span data-testid="no-prices">{data.reason}</span>} />
      ) : (
        <Player key={`${day}:${data.symbol}`} data={data} lines={NO_LINES} currency={currency} label={`${data.symbol} price, replayed for ${day}`} />
      )}
      <div className="mt-6"><LinkedNotes day={day} title={`Notes for ${day}`} sample={sample} /></div>
    </div>
  );
}

const NO_LINES: PriceLine[] = [];

function Player({ data, lines, currency, label }: { data: Omit<TradeBarsResponse, "trade">; lines: PriceLine[]; currency?: string; label: string }) {
  const { bars, markers, positions } = data;
  const firstFill = Math.min(...markers.map((m) => m.t));
  const lead = Math.max(1, Math.min(bars.length, bars.findIndex((b) => b.t + (bars[1]?.t - bars[0]?.t || 60) > firstFill) + 1 - LEAD_BARS));
  const [at, setAt] = useState(lead);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const step = bars[1] ? bars[1].t - bars[0].t : 60;
  const atEnd = at >= bars.length;

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setInterval(() => setAt((i) => Math.min(bars.length, i + 1)), 1000 / Number(speed));
    return () => clearInterval(timer);
  }, [playing, speed, atEnd, bars.length]);

  const now = bars[Math.max(0, at - 1)];
  // Fills count once their bar has fully shown. Price is that bar's close, so an open position's figure moves bar by bar.
  const time = now.t + step - 1;
  const pnl = useMemo(() => replayPnl(positions, time, now.c), [positions, time, now.c]);
  const done = markers.filter((m) => m.t <= time).sort((a, b) => a.t - b.t);
  const next = [...markers].sort((a, b) => a.t - b.t).find((m) => m.t > time);
  const barOf = (t: number) => bars.findIndex((b) => b.t <= t && t < b.t + step) + 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || document.querySelector("dialog[open]")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setAt((i) => Math.min(bars.length, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setAt((i) => Math.max(1, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bars.length]);

  return (
    <div className="space-y-3">
      <CandleChart bars={bars} markers={markers} lines={lines} upTo={at} height={380} label={label} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
        {data.source === "simulated" && <Badge tone="info">Simulated</Badge>}
        <span>{sourceNote(data.source, data.timeframe)}. Bars show their full range, so the order of moves inside a bar isn&apos;t known.</span>
      </p>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Replay controls">
        <Button size="sm" className="max-sm:h-11" aria-label="Back to the start" onClick={() => { setPlaying(false); setAt(1); }}>Start</Button>
        <Button size="sm" className="max-sm:h-11" aria-label="Back one bar" disabled={at <= 1} onClick={() => { setPlaying(false); setAt((i) => Math.max(1, i - 1)); }}>Back</Button>
        <Button size="sm" variant="primary" className="w-20 max-sm:h-11" disabled={atEnd} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</Button>
        <Button size="sm" className="max-sm:h-11" aria-label="Forward one bar" disabled={atEnd} onClick={() => { setPlaying(false); setAt((i) => Math.min(bars.length, i + 1)); }}>Forward</Button>
        <Button size="sm" className="max-sm:h-11" disabled={!next} onClick={() => { setPlaying(false); if (next) setAt(barOf(next.t)); }}>Next fill</Button>
        <Button size="sm" className="max-sm:h-11" aria-label="Jump to the end" disabled={atEnd} onClick={() => { setPlaying(false); setAt(bars.length); }}>End</Button>
        <Segmented label="Replay speed" value={speed} onChange={setSpeed} options={[...SPEEDS]} />
        <input aria-label="Position in the replay" type="range" min={1} max={bars.length} value={at} onChange={(e) => { setPlaying(false); setAt(Number(e.target.value)); }} className="min-w-40 flex-1 accent-[var(--accent)]" />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-line py-2 sm:grid-cols-5 text-[13px]" aria-live="off">
        <div><dt className="text-muted">Time</dt><dd className="num text-ink" data-testid="replay-clock">{timeOnly(new Date(now.t * 1000).toISOString())}</dd></div>
        <div><dt className="text-muted">Bar</dt><dd className="num text-ink" data-testid="replay-bar">{at} of {bars.length}</dd></div>
        <div><dt className="text-muted">Open position</dt><dd className="num text-ink" data-testid="replay-size">{pnl.size === 0 ? "Flat" : `${pnl.size > 0 ? "Long" : "Short"} ${Math.abs(pnl.size)}`}</dd></div>
        <div><dt className="text-muted">Unrealized</dt><dd className={cx("num", toneOf(pnl.open))} data-testid="replay-open">{money(pnl.open, currency, true)}</dd></div>
        <div><dt className="text-muted">Realized, before costs</dt><dd className={cx("num", toneOf(pnl.realized))} data-testid="replay-realized">{money(pnl.realized, currency, true)}</dd></div>
      </dl>

      <section aria-label="Fills so far">
        <h2 className="text-[13px] font-medium text-ink">Fills so far</h2>
        {done.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted">None yet. {next ? `The first is at ${timeOnly(new Date(next.t * 1000).toISOString())}.` : ""}</p>
        ) : (
          <ol className="mt-1 divide-y divide-line border-y border-line text-[13px]" data-testid="replay-fills">
            {done.map((m, i) => (
              <li key={`${m.tradeId}-${m.t}-${i}`} className="flex flex-wrap items-baseline gap-x-3 py-1">
                <span className="num text-muted">{timeOnly(new Date(m.t * 1000).toISOString())}</span>
                <span>{(m.role === "entry") === (m.side === "long") ? "Bought" : "Sold"} <span className="num">{m.quantity}</span> at <span className="num">{m.price}</span></span>
                <span className="text-muted">{m.role === "entry" ? "Entry" : "Exit"}, trade #{m.tradeId}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <p className="hidden text-[12.5px] text-muted md:block"><kbd>Space</kbd> plays and pauses, <kbd>Left</kbd> and <kbd>Right</kbd> step a bar.</p>
    </div>
  );
}
