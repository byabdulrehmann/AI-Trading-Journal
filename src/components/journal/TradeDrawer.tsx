"use client";

import { useApp } from "@/lib/client/app-state";
import { dateTime, duration, money, rFmt, toneOf } from "@/lib/client/format";
import { holdMinutes } from "@/lib/domain/metrics";
import { plannedRisk } from "@/lib/domain/trade-math";
import { Badge, Button, Dialog } from "../ui";
import { useTradeActions } from "./useTradeActions";

export function TradeDrawer() {
  const { openTradeId, openTrade, trades, accounts, editTrade, askJarvis, settings } = useApp();
  const { deleteTrades } = useTradeActions();
  const trade = trades.find((t) => t.id === openTradeId) ?? null;
  const account = accounts.find((a) => a.id === trade?.accountId);
  const cur = account?.currency ?? "USD";

  return (
    <Dialog open={openTradeId !== null} onClose={() => openTrade(null)} title={trade ? `#${trade.id} · ${trade.symbol} ${trade.side}` : "Trade"} wide>
      {!trade ? (
        <p className="text-[14px] text-muted">This trade isn&apos;t in your journal (it may have been deleted).</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={trade.side === "long" ? "info" : "accent"}>{trade.side}</Badge>
            {trade.closedAt ? <Badge>Closed</Badge> : <Badge tone="accent">Open</Badge>}
            {trade.source === "sample" && <Badge tone="info">Sample data</Badge>}
            {trade.source === "csv" && <Badge>Imported</Badge>}
            {trade.grade && <Badge>Grade {trade.grade}</Badge>}
            {trade.followedPlan !== null && <Badge tone={trade.followedPlan ? "profit" : "loss"}>{trade.followedPlan ? "On plan" : "Off plan"}</Badge>}
            <span className="ml-auto text-[13px] text-muted">{account?.name}</span>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              ["Net P&L", <span key="p" className={toneOf(trade.pnl)}>{money(trade.pnl, cur, true)}</span>],
              ["Result", rFmt(trade.rMultiple)],
              ["Planned", trade.plannedR === null ? "—" : `${trade.plannedR}R`],
              ["Risk", money(plannedRisk(trade), cur)],
              ["Entry", trade.entryPrice],
              ["Exit", trade.exitPrice ?? "—"],
              ["Stop", trade.stopPrice ?? "—"],
              ["Target", trade.targetPrice ?? "—"],
              ["Size", `${trade.quantity}${trade.multiplier !== 1 ? ` × ${trade.multiplier}` : ""}`],
              ["Fees", money(trade.fees, cur)],
              ["Opened", dateTime(trade.openedAt)],
              ["Held", duration(holdMinutes(trade))],
            ].map(([k, v]) => (
              <div key={k as string} className="min-w-0">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="num truncate text-[14px] text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">Plan</h3>
              <p className="mt-1 text-[14px] whitespace-pre-wrap text-ink-soft">{trade.planNotes || "No plan notes."}</p>
              {trade.setup && <p className="mt-2 text-[13px] text-muted">Setup: {trade.setup}</p>}
            </div>
            <div className="rounded-lg border border-line p-3">
              <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">Review</h3>
              <p className="mt-1 text-[13px] text-muted">
                Feeling: {trade.emotionBefore ?? "—"} → {trade.emotionAfter ?? "—"}
              </p>
              <p className="mt-1 text-[14px] whitespace-pre-wrap text-ink-soft">{trade.notes || "No notes."}</p>
              {trade.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {trade.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {settings?.jarvis.enabled && (
              <Button
                variant="primary"
                onClick={() => {
                  openTrade(null);
                  askJarvis(`Review trade #${trade.id} with me.`, trade.id);
                }}
              >
                Review with Jarvis
              </Button>
            )}
            <Button
              onClick={() => {
                openTrade(null);
                editTrade(trade);
              }}
            >
              Edit
            </Button>
            <Button variant="danger" className="ml-auto" onClick={() => deleteTrades([trade.id])}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
