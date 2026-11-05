"use client";

import { useApp } from "@/lib/client/app-state";
import { SESSION_LABELS, dateTime, duration, fileSize, money, rFmt, toneOf } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { pipsBetween } from "@/lib/domain/engine/instruments";
import type { Trade } from "@/lib/domain/types";
import type { InstrumentSpec } from "@/lib/server/repo/journal";
import { Badge, Button, Dialog, Spinner } from "../ui";
import { PnlIssue, SideBadge, SourceBadge, StatusBadge } from "./badges";
import { useTradeActions } from "./useTradeActions";

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[12.5px] text-muted">{k}</dt>
          <dd className="num text-[14px] break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-[14px] font-semibold">{children}</h3>;

function Prose({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="text-[14px] whitespace-pre-wrap text-ink-soft">{text}</p>
    </div>
  );
}

export function TradeDrawer() {
  const { openTradeId, openTrade } = useApp();
  const { data, error } = useFetch<{ trade: Trade }>(openTradeId === null ? null : `/api/trades/${openTradeId}`);
  const trade = data?.trade.id === openTradeId ? data!.trade : null;

  return (
    <Dialog open={openTradeId !== null} onClose={() => openTrade(null)} title={trade ? `${trade.symbol} ${trade.side}, trade #${trade.id}` : "Trade"} drawer>
      {trade ? <TradeDetail trade={trade} /> : error ? <p className="text-[14px] text-muted">This trade couldn&apos;t be opened. It may have been deleted.</p> : <Spinner label="Loading the trade" />}
    </Dialog>
  );
}

function TradeDetail({ trade: t }: { trade: Trade }) {
  const { openTrade, accounts, editTrade, askJarvis, settings } = useApp();
  const { deleteTrades, duplicateTrade } = useTradeActions();
  const specs = useFetch<{ instruments: InstrumentSpec[] }>(`/api/instruments?accountId=${t.accountId}`);
  const account = accounts.find((a) => a.id === t.accountId);
  const cur = account?.currency ?? "USD";
  const spec = specs.data?.instruments.find((i) => i.symbol === t.symbol);
  const pips = t.exitPrice === null ? null : pipsBetween(t.symbol, t.side, t.entryPrice, t.exitPrice, spec?.digits);
  const execs = t.executions ?? [];
  const brokerIds = execs.some((e) => e.brokerDealId || e.brokerOrderId);
  const flags = [t.revengeTrade && "Revenge trade", t.overtrading && "Overtrading", t.impulsiveEntry && "Impulsive entry", t.earlyExit && "Early exit"].filter(Boolean) as string[];
  const ratings = [["Confidence", t.confidence], ["Discipline", t.discipline], ["Fear", t.fear], ["Greed", t.greed]] as const;
  const hasAnalysis = t.setup || t.planNotes || t.entryReason || t.exitReason || t.notes || t.lessons || t.mistakes.length || t.tags.length || t.strategyTags.length || t.emotionBefore || t.emotionAfter;
  const hasPsych = flags.length || t.ruleViolations || t.followedPlan !== null || t.grade || ratings.some(([, v]) => v !== null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SideBadge side={t.side} />
        <StatusBadge status={t.status} />
        <SourceBadge source={t.source} />
        <PnlIssue status={t.pnlStatus} />
        <span className="ml-auto text-[13px] text-muted">{account?.name}</span>
      </div>

      <div>
        <p className="text-[12.5px] text-muted">Net P&amp;L{t.status === "partial" ? " realized so far" : ""}</p>
        {t.pnlStatus === "needs_rate" ? (
          <p className="text-[14px] text-ink-soft">Pending: a conversion rate to {cur} is missing. Edit the trade to enter it.</p>
        ) : (
          <p className={`num text-[28px] leading-tight ${toneOf(t.pnl)}`}>{t.pnl === null ? "Open" : money(t.pnl, cur, true)}</p>
        )}
      </div>

      <Facts
        items={[
          ["R", rFmt(t.rMultiple)],
          ["Planned R", t.plannedR === null ? "—" : `${t.plannedR}R`],
          ["Risk", money(t.riskAmount, cur)],
          ["Duration", duration(t.holdingMinutes)],
          ["Entry", t.entryPrice],
          ["Exit", t.exitPrice ?? "—"],
          ["Stop", t.stopPrice ?? "—"],
          ["Target", t.targetPrice ?? "—"],
          ["Size", t.multiplier === 1 ? t.quantity : `${t.quantity} × ${t.multiplier}`],
          ["Remaining", t.remainingQty],
          ["Pips", pips ?? "—"],
          ["Session", t.session ? SESSION_LABELS[t.session] : "—"],
          ["Opened", dateTime(t.openedAt)],
          ["Closed", dateTime(t.closedAt)],
          ["Asset class", <span key="c" className="capitalize">{t.assetClass}</span>],
          ["Strategy", t.strategy || "—"],
        ]}
      />

      <section className="border-t border-line pt-4">
        <Heading>Costs</Heading>
        <Facts
          items={[
            ["Gross P&L", money(t.grossPnl, cur, true)],
            ["Commission", money(t.commission, cur)],
            ["Swap", money(t.swap, cur)],
            ["Other fees", money(t.otherFees, cur)],
          ]}
        />
        {t.fxRate !== null && <p className="num mt-2 text-[12.5px] text-muted">Conversion rate {t.fxRate}</p>}
      </section>

      <section className="border-t border-line pt-4">
        <Heading>Executions</Heading>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-normal">Side</th>
                <th scope="col" className="py-1 pr-3 font-normal">Time</th>
                <th scope="col" className="py-1 pr-3 text-right font-normal">Price</th>
                <th scope="col" className="py-1 pr-3 text-right font-normal">Size</th>
                {brokerIds && <th scope="col" className="py-1 pr-3 text-right font-normal">Profit</th>}
                {brokerIds && <th scope="col" className="py-1 pr-3 font-normal">Deal</th>}
                {brokerIds && <th scope="col" className="py-1 font-normal">Order</th>}
              </tr>
            </thead>
            <tbody className="num">
              {execs.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1.5 pr-3 font-sans capitalize">{e.role}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{dateTime(e.executedAt)}</td>
                  <td className="py-1.5 pr-3 text-right">{e.price}</td>
                  <td className="py-1.5 pr-3 text-right">{e.quantity}</td>
                  {brokerIds && <td className="py-1.5 pr-3 text-right">{money(e.profit, cur)}</td>}
                  {brokerIds && <td className="py-1.5 pr-3">{e.brokerDealId ?? "—"}</td>}
                  {brokerIds && <td className="py-1.5">{e.brokerOrderId ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t.brokerPositionId && <p className="num mt-2 text-[12.5px] text-muted">Broker position {t.brokerPositionId}</p>}
      </section>

      {hasAnalysis ? (
        <section className="space-y-2.5 border-t border-line pt-4">
          <Heading>Analysis</Heading>
          <Prose label="Setup" text={t.setup} />
          <Prose label="Setup description" text={t.planNotes} />
          <Prose label="Entry reason" text={t.entryReason} />
          <Prose label="Exit reason" text={t.exitReason} />
          <Prose label="Notes" text={t.notes} />
          <Prose label="Lessons" text={t.lessons} />
          {(t.emotionBefore || t.emotionAfter) && <p className="text-[13.5px] text-ink-soft capitalize">Feeling before: {t.emotionBefore ?? "not recorded"}. After: {t.emotionAfter ?? "not recorded"}.</p>}
          {t.mistakes.length + t.tags.length + t.strategyTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {t.mistakes.map((m) => <Badge key={m} tone="loss">{m.replace(/_/g, " ")}</Badge>)}
              {t.strategyTags.map((x) => <Badge key={x} tone="accent">{x}</Badge>)}
              {t.tags.map((x) => <Badge key={x}>{x}</Badge>)}
            </div>
          )}
        </section>
      ) : (
        <p className="border-t border-line pt-4 text-[13.5px] text-muted">No analysis yet. Edit the trade to note why you took it and how it went.</p>
      )}

      {hasPsych ? (
        <section className="space-y-2.5 border-t border-line pt-4">
          <Heading>Psychology</Heading>
          <Facts items={[...ratings.map(([k, v]) => [k, v === null ? "—" : `${v} of 5`] as [string, React.ReactNode]), ["Followed plan", t.followedPlan === null ? "—" : t.followedPlan ? "Yes" : "No"], ["Grade", t.grade ?? "—"]]} />
          {flags.length > 0 && <div className="flex flex-wrap gap-1">{flags.map((f) => <Badge key={f} tone="warn">{f}</Badge>)}</div>}
          <Prose label="Rule violations" text={t.ruleViolations} />
        </section>
      ) : null}

      <section className="border-t border-line pt-4">
        <Heading>Attachments</Heading>
        {t.attachments?.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {t.attachments.map((a) => (
              <li key={a.id} className="min-w-0">
                <a href={`/api/attachments/${a.id}`} target={a.mime.startsWith("image/") ? "_blank" : undefined} rel="noreferrer" className="block overflow-hidden rounded-control border border-line hover:border-line-strong">
                  {a.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private, authenticated file; next/image can't optimise it
                    <img src={`/api/attachments/${a.id}`} alt={`${a.kind}: ${a.filename}`} className="h-24 w-full object-cover" />
                  ) : (
                    <span className="flex h-24 items-center justify-center bg-sunken text-[13px] text-muted">PDF, download</span>
                  )}
                </a>
                <p className="mt-1 truncate text-[12.5px] text-ink-soft" title={a.filename}>{a.filename}</p>
                <p className="text-[12px] text-muted capitalize">{a.kind}, {fileSize(a.size)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted">No files yet. Edit the trade to add chart screenshots or documents.</p>
        )}
      </section>

      <div className="sticky -bottom-4 -mx-card -mb-4 flex flex-wrap gap-2 border-t border-line bg-surface px-card py-3">
        {settings?.jarvis.enabled && (
          <Button
            variant="primary"
            onClick={() => {
              openTrade(null);
              askJarvis(`Review trade #${t.id} with me.`, t.id);
            }}
          >
            Review with AI Coach
          </Button>
        )}
        <Button
          onClick={() => {
            openTrade(null);
            editTrade(t.id);
          }}
        >
          Edit
        </Button>
        <Button onClick={() => void duplicateTrade(t.id)}>Duplicate</Button>
        <Button variant="danger" className="ml-auto" onClick={() => void deleteTrades([t.id])}>
          Delete
        </Button>
      </div>
    </div>
  );
}
