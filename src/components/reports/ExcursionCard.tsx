"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { rFmt } from "@/lib/client/format";
import { METRIC_DEFINITIONS as D, type ExcursionStats } from "@/lib/domain/metrics";
import { Button, Card, CardHeader, Metric, Notice } from "@/components/ui";

/** MAE and MFE need prices for each trade, so reading them is something you start, and can stop. */
export function ExcursionCard({ stats, unread, query, onDone }: { stats: ExcursionStats; unread: number; query: string; onDone: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const stop = useRef(false);

  const run = async () => {
    setBusy(true);
    setDone(0);
    setNote(null);
    stop.current = false;
    const skip: number[] = [];
    let total = 0;
    let reason: string | null = null;
    try {
      while (!stop.current) {
        const res = await api<{ read: number; failed: number[]; reason: string | null; remaining: number }>(`/api/excursions?${query}`, { method: "POST", json: { limit: 10, skip } });
        total += res.read;
        skip.push(...res.failed);
        reason = res.reason ?? reason;
        setDone(total);
        if (res.remaining === 0 || (res.read === 0 && res.failed.length === 0)) break;
      }
      setNote(skip.length ? `Read ${total}. ${skip.length} had no prices. ${reason ?? ""}` : `Read ${total}.`);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't read prices.", tone: "error" });
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Card>
      <CardHeader title="How far trades went" subtitle="MAE and MFE, read from price bars. Bars can't show what came first inside them, so treat these as close, not exact." />
      <dl data-testid="excursion-report">
        <Metric def={D.avgMfe} value={rFmt(stats.avgMfeR)} tone="text-profit" note={stats.sample ? `${stats.sample} trades with prices and a stop` : "Needs trades with prices and a stop"} />
        <Metric def={D.avgMae} value={stats.avgMaeR === null ? "—" : rFmt(-stats.avgMaeR)} tone="text-loss" />
        <Metric def={D.leftBehind} value={rFmt(stats.leftBehindR)} />
      </dl>
      {unread > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          <span><span className="num">{unread}</span> closed {unread === 1 ? "trade hasn't" : "trades haven't"} been read yet.</span>
          {busy ? (
            <>
              <span role="status">Read <span className="num">{done}</span> so far</span>
              <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => { stop.current = true; }}>Stop</Button>
            </>
          ) : (
            <Button size="sm" className="max-sm:h-11" onClick={() => void run()}>Read prices for them</Button>
          )}
        </div>
      )}
      {note && <div className="mt-2"><Notice tone="info">{note}</Notice></div>}
    </Card>
  );
}
