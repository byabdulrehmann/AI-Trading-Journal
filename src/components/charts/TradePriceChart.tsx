"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/lib/client/app-state";
import { money } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { Bar, BarMarker, BarSource, Timeframe } from "@/lib/domain/bars";
import { Badge, Spinner } from "@/components/ui";
import { CandleChart, type PriceLine } from "./CandleChart";

export interface TradeBarsResponse {
  source: BarSource | null;
  reason: string | null;
  timeframe: Timeframe;
  bars: Bar[];
  markers: BarMarker[];
  positions: { side: "long" | "short"; perPoint: number; fills: { role: "entry" | "exit"; price: number; quantity: number; at: number }[] }[];
  trade: { id: number; symbol: string; side: "long" | "short"; entryPrice: number; exitPrice: number | null; stopPrice: number | null; targetPrice: number | null; mae: number | null; mfe: number | null; quantity: number; multiplier: number; fxRate: number | null; grossPnl: number | null; accountId: number };
}

export const sourceNote = (source: BarSource | null, timeframe: Timeframe) => (source === "simulated" ? "Made-up prices for this sample trade" : `${timeframe === "H1" ? "1-hour" : `${timeframe.slice(1)}-minute`} bars from your MT5 broker`);

/** The trade's chart, or the plain reason there's none. Prices are never invented for a real trade. */
export function TradePriceChart({ tradeId, onReplay }: { tradeId: number; onReplay?: () => void }) {
  const { accounts } = useApp();
  const { data, error, reload } = useFetch<TradeBarsResponse>(`/api/trades/${tradeId}/bars`);
  const lines = useMemo<PriceLine[]>(() => {
    if (!data) return [];
    return [
      ...(data.trade.stopPrice === null ? [] : [{ price: data.trade.stopPrice, label: "Stop", tone: "loss" as const }]),
      ...(data.trade.targetPrice === null ? [] : [{ price: data.trade.targetPrice, label: "Target", tone: "profit" as const }]),
    ];
  }, [data]);

  return (
    <section className="border-t border-line pt-4" aria-label="Price chart" data-testid="trade-chart">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">Price</h3>
        {data?.bars.length ? <Link href={`/replay?trade=${tradeId}${data.source === "simulated" ? "&includeSample=1" : ""}`} onClick={onReplay} className="text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink">Replay this trade</Link> : null}
      </div>
      {error ? (
        <p className="text-[13px] text-muted">Couldn&apos;t load prices. <button type="button" className="underline underline-offset-2" onClick={reload}>Try again</button></p>
      ) : !data ? (
        <Spinner label="Loading prices" />
      ) : data.bars.length === 0 ? (
        <p className="text-[13px] text-muted" data-testid="no-prices">{data.reason}</p>
      ) : (
        <>
          <CandleChart bars={data.bars} markers={data.markers} lines={lines} label={`${data.trade.symbol} price, with this trade's entries and exits marked`} height={230} />
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
            {data.source === "simulated" && <Badge tone="info">Simulated</Badge>}
            <span>{sourceNote(data.source, data.timeframe)}.</span>
            {data.trade.mfe !== null && data.trade.mae !== null && (
              <span data-testid="excursions">
                Best <span className="num text-profit">{money(data.trade.mfe * data.trade.quantity * data.trade.multiplier * (data.trade.fxRate ?? 1), accounts.find((a) => a.id === data.trade.accountId)?.currency)}</span>, worst <span className="num text-loss">{money(-data.trade.mae * data.trade.quantity * data.trade.multiplier * (data.trade.fxRate ?? 1), accounts.find((a) => a.id === data.trade.accountId)?.currency)}</span> while open
              </span>
            )}
          </p>
        </>
      )}
    </section>
  );
}
