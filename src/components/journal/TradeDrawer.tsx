"use client";

import { useApp } from "@/lib/client/app-state";
import { SESSION_LABELS, dateTime, duration, fileSize, money, rFmt, toneOf, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { pipsBetween } from "@/lib/domain/engine/instruments";
import type { Trade } from "@/lib/domain/types";
import type { InstrumentSpec } from "@/lib/server/repo/journal";
import { RowsSkeleton } from "../tape/Skeletons";
import { Button, Dialog, cx } from "../ui";
import { LinkedNotes } from "@/components/notebook/LinkedNotes";
import { TradePriceChart } from "@/components/charts/TradePriceChart";
import { PlaybookChecklist } from "./Checklist";
import { PnlIssue, SideBadge, SourceBadge, StatusBadge } from "./badges";
import { useTradeActions } from "./useTradeActions";

/** Ticket lines: label left, value right, on hairlines, two columns where they fit. */
function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line py-1">
          <dt className="shrink-0 text-[13px] text-muted">{k}</dt>
          <dd className="num min-w-0 text-right text-[13.5px] break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Entry, stop, target and exit on one price line. Red spans the risk, green the reward. */
function PriceDiagram({ t }: { t: Trade }) {
  const marks = [
    { name: "Stop", price: t.stopPrice },
    { name: "Entry", price: t.entryPrice as number | null },
    { name: "Target", price: t.targetPrice },
  ].filter((m): m is { name: string; price: number } => m.price !== null);
  const exit = t.exitPrice;
  const all = [...marks.map((m) => m.price), ...(exit === null ? [] : [exit])];
  if (all.length < 2) return null;
  const min = Math.min(...all);
  const span = Math.max(...all) - min;
  if (span <= 0) return null;
  const at = (p: number) => ((p - min) / span) * 100;
  const place = (p: number): React.CSSProperties => {
    const x = at(p);
    return x < 14 ? { left: `${x}%` } : x > 86 ? { right: `${100 - x}%` } : { left: `${x}%`, transform: "translateX(-50%)" };
  };
  const band = (a: number | null, b: number | null, cls: string) => a !== null && b !== null && <span aria-hidden className={cx("absolute inset-y-0", cls)} style={{ left: `${Math.min(at(a), at(b))}%`, width: `${Math.abs(at(a) - at(b))}%` }} />;
  const sorted = [...marks].sort((p, q) => p.price - q.price);
  // A label too close to the one before it drops a row, so prices never overprint.
  const lifted = new Set(sorted.filter((m, i) => i === 1 && at(m.price) - at(sorted[0].price) < 30).map((m) => m.name));
  const label = (name: string, price: number, style: React.CSSProperties, cls?: string) => (
    <span key={name} className={cx("absolute text-[12px] whitespace-nowrap text-muted", cls)} style={style}>
      {name} <span className="num text-ink-soft">{price}</span>
    </span>
  );
  return (
    <figure aria-label={`Prices: ${marks.map((m) => `${m.name} ${m.price}`).join(", ")}${exit === null ? "" : `, Exit ${exit}`}`} className="mx-1">
      <div className="relative h-5">{exit !== null && label("Exit", exit, place(exit))}</div>
      <div className="relative h-3 bg-sunken">
        {band(t.stopPrice, t.entryPrice, "bg-loss-soft")}
        {band(t.entryPrice, t.targetPrice, "bg-profit-soft")}
        {marks.map((m) => <span key={m.name} aria-hidden className="absolute -inset-y-0.5 w-px bg-line-strong" style={{ left: `${at(m.price)}%` }} />)}
        {exit !== null && <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `${at(exit)}%` }} />}
      </div>
      <div className={cx("relative", lifted.size ? "h-10" : "h-5")}>
        {sorted.map((m) => label(m.name, m.price, place(m.price), lifted.has(m.name) ? "top-5" : "top-0.5"))}
      </div>
    </figure>
  );
}

const Heading = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 text-[14px] font-medium">{children}</h3>;

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
      {trade ? <TradeDetail trade={trade} /> : error ? <p className="text-[14px] text-muted">This trade couldn&apos;t be opened. It may have been deleted.</p> : <RowsSkeleton rows={12} />}
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
      <div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <p className="text-[13px] text-muted">Net P&amp;L{t.status === "partial" ? " realized so far" : ""}</p>
            {t.pnlStatus === "needs_rate" ? (
              <p className="max-w-sm text-[14px] text-ink-soft">Pending: a conversion rate to {cur} is missing. Edit the trade to enter it.</p>
            ) : (
              <p className={`num text-[34px] leading-none tracking-[-0.03em] ${toneOf(t.pnl)}`}>{t.pnl === null ? "Open" : money(t.pnl, cur, true)}</p>
            )}
          </div>
          <div>
            <p className="text-[13px] text-muted">R</p>
            <p className={`num text-[34px] leading-none tracking-[-0.03em] ${toneOf(t.rMultiple)}`}>{rFmt(t.rMultiple)}</p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <SideBadge side={t.side} />
          <StatusBadge status={t.status} />
          <SourceBadge source={t.source} />
          <PnlIssue status={t.pnlStatus} />
          <span className="ml-auto text-[13px] text-muted">{account?.name}</span>
        </div>
      </div>

      <PriceDiagram t={t} />

      <Facts
        items={[
          ["Planned R", t.plannedR === null ? "—" : `${t.plannedR}R`],
          ["Risk", money(t.riskAmount, cur)],
          ["Entry", t.entryPrice],
          ["Exit", t.exitPrice ?? "—"],
          ["Stop", t.stopPrice ?? "—"],
          ["Target", t.targetPrice ?? "—"],
          ["Size", t.multiplier === 1 ? t.quantity : `${t.quantity} × ${t.multiplier}`],
          ["Remaining", t.remainingQty],
          ["Pips", pips ?? "—"],
          ["Duration", duration(t.holdingMinutes)],
          [`Opened, ${zoneName()}`, dateTime(t.openedAt)],
          [`Closed, ${zoneName()}`, dateTime(t.closedAt)],
          ["Session", <span key="s" className="font-sans">{t.session ? SESSION_LABELS[t.session] : "—"}</span>],
          ["Asset class", <span key="c" className="font-sans capitalize">{t.assetClass}</span>],
          ...(t.assetClass === "option" && t.strike !== null ? ([["Option", <span key="o" className="capitalize">{t.optionRight} {t.strike}, expires {t.expiry}</span>]] as [string, React.ReactNode][]) : []),
          ["Strategy", <span key="st" className="font-sans">{t.strategy || "—"}</span>],
        ]}
      />

      <section className="border-t border-line pt-4">
        <Heading>Executions</Heading>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="py-1 pr-3 font-normal">Side</th>
                <th scope="col" className="py-1 pr-3 font-normal whitespace-nowrap">Time</th>
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
            <dl className="space-y-1 text-[13px]">
              {t.mistakes.length > 0 && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Mistakes</dt><dd className="text-warn">{t.mistakes.map((m) => m.replace(/_/g, " ")).join(", ")}</dd></div>}
              {t.strategyTags.length > 0 && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Strategy tags</dt><dd className="text-ink-soft">{t.strategyTags.join(", ")}</dd></div>}
              {t.tags.length > 0 && <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">Tags</dt><dd className="text-ink-soft">{t.tags.join(", ")}</dd></div>}
            </dl>
          )}
        </section>
      ) : (
        <p className="border-t border-line pt-4 text-[13.5px] text-muted">No analysis yet. Edit the trade to note why you took it and how it went.</p>
      )}

      <TradePriceChart key={`chart-${t.id}`} tradeId={t.id} onReplay={() => openTrade(null)} />
      <PlaybookChecklist key={t.id} tradeId={t.id} />
      <LinkedNotes tradeId={t.id} title={`${t.symbol}, trade #${t.id}`} sample={t.source === "sample"} onLeave={() => openTrade(null)} />

      {hasPsych ? (
        <section className="space-y-2.5 border-t border-line pt-4">
          <Heading>Psychology</Heading>
          <Facts items={[...ratings.map(([k, v]) => [k, v === null ? "—" : `${v} of 5`] as [string, React.ReactNode]), ["Followed plan", t.followedPlan === null ? "—" : t.followedPlan ? "Yes" : "No"], ["Grade", t.grade ?? "—"]]} />
          {flags.length > 0 && <p className="text-[13px] text-warn">{flags.join(", ")}</p>}
          <Prose label="Rule violations" text={t.ruleViolations} />
        </section>
      ) : null}

      <section className="border-t border-line pt-4">
        <Heading>Attachments</Heading>
        {t.attachments?.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {t.attachments.map((a) => (
              <li key={a.id} className="min-w-0">
                <a href={`/api/attachments/${a.id}`} target={a.mime.startsWith("image/") ? "_blank" : undefined} rel="noreferrer" className="block overflow-hidden border border-line hover:border-line-strong">
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

      <div className="sticky -bottom-4 -mx-card -mb-4 flex flex-wrap gap-2 border-t border-line bg-canvas px-card py-3">
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
