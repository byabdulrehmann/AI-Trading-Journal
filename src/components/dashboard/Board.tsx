"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useStored } from "@/lib/client/use-stored";
import type { Analytics } from "@/lib/client/analytics";
import { currencySymbol, dateTime, money, pct, profitFactorText } from "@/lib/client/format";
import { journalHref } from "@/lib/client/journal-links";
import { niceTicks } from "@/lib/client/ladder";
import { useBoxSize } from "@/lib/client/use-box-size";
import { cumulativeByDay, monthGrid, monthStats, shiftMonth, shortMoney, weekSummaries, type DayResult } from "@/lib/domain/board";
import { METRIC_DEFINITIONS as D, type ScoreAxis } from "@/lib/domain/metrics";
import type { Account, Trade } from "@/lib/domain/types";
import { Tip, useScrub } from "@/components/charts";
import { Dropdown, ICONS, Icon } from "@/components/Dropdown";
import { Dialog, cx } from "@/components/ui";

export const panel = "rounded-panel border border-line bg-glass shadow-card";
const LABEL = 10.5;

/** The "i" beside a title: the formula, on hover or focus. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label={`How ${label} is calculated`} className="grid size-4 place-items-center rounded-full text-muted hover:text-ink">
        <Icon d={ICONS.info} size={14} />
      </button>
      <span role="tooltip" className="pointer-events-none absolute top-full left-1/2 z-[var(--z-modal)] mt-1.5 hidden w-60 -translate-x-1/2 rounded-control bg-ink px-2.5 py-2 text-[12px] leading-snug font-normal text-surface shadow-xl group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

// ---------- KPI cards ----------

/**
 * Sized from the card's own width (a container query), not the window's: with the sidebar open, five cards across
 * can be narrow on a wide screen. `beside` puts the visual in the value's row, under the label, as Avg win/loss does.
 */
function KpiCard({ label, info, children, visual, beside, testId }: { label: string; info: string; children: React.ReactNode; visual?: React.ReactNode; beside?: React.ReactNode; testId: string }) {
  return (
    <section className={cx(panel, "@container min-h-[112px] min-w-0 px-4 py-4 @[15rem]:px-5")} data-testid={testId} aria-label={label}>
      <div className="flex h-full items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-muted">
            <span className="truncate">{label}</span>
            <InfoTip text={info} label={label} />
          </h2>
          <div className="mt-2 flex items-center gap-3">
            <div className="min-w-0 shrink-0">{children}</div>
            {beside && <div className="ml-auto min-w-0 flex-1 basis-20 max-w-[200px]">{beside}</div>}
          </div>
        </div>
        {visual && <div className="shrink-0">{visual}</div>}
      </div>
    </section>
  );
}

/** A semicircle split into wins, breakeven and losses, in that order from the left. */
export function Gauge({ parts, label }: { parts: [number, number, number]; label: string }) {
  const total = parts[0] + parts[1] + parts[2];
  const colors = ["var(--profit)", "var(--line-strong)", "var(--loss)"];
  const d = "M7 43 A36 36 0 0 1 79 43";
  let start = 0;
  const shown = parts.filter((p) => p > 0).length;
  return (
    <svg viewBox="0 0 86 48" role="img" aria-label={label} className="h-auto w-[64px] @[16rem]:w-[86px]">
      <path d={d} fill="none" stroke="var(--sunken)" strokeWidth="7" strokeLinecap="round" />
      {total > 0 &&
        parts.map((p, i) => {
          if (p === 0) return null;
          const len = (p / total) * 100;
          const gap = shown > 1 ? 1.6 : 0;
          const el = <path key={i} d={d} pathLength={100} fill="none" stroke={colors[i]} strokeWidth="7" strokeDasharray={`${Math.max(0.5, len - gap)} 100`} strokeDashoffset={-start} />;
          start += len;
          return el;
        })}
    </svg>
  );
}

function Pills({ parts, hrefs }: { parts: [number, number, number]; hrefs?: [string, string, string] }) {
  const tones = ["bg-profit-soft text-profit", "bg-sunken text-ink-soft", "bg-loss-soft text-loss"];
  const names = ["won", "breakeven", "lost"];
  return (
    <span className="mt-1 flex justify-center gap-0.5 @[16rem]:gap-1">
      {parts.map((n, i) => {
        const cls = cx("num min-w-5 rounded-full px-1 text-center text-[10px] leading-[16px] font-semibold @[16rem]:min-w-6 @[16rem]:px-1.5 @[16rem]:text-[10.5px]", tones[i]);
        return hrefs ? (
          <Link key={i} href={hrefs[i]} className={cx(cls, "hover:ring-1 hover:ring-current")} aria-label={`${n} ${names[i]}`}>{n}</Link>
        ) : (
          <span key={i} className={cls} aria-label={`${n} ${names[i]}`}>{n}</span>
        );
      })}
    </span>
  );
}

function Ring({ profit, loss }: { profit: number; loss: number }) {
  const total = profit + Math.abs(loss);
  const share = total ? (profit / total) * 100 : 0;
  return (
    <svg viewBox="0 0 56 56" className="h-auto w-11 @[16rem]:w-14" role="img" aria-label={total ? `Gross profit is ${share.toFixed(0)}% of gross profit and loss together` : "No closed trades"}>
      <circle cx="28" cy="28" r="22" fill="none" stroke="var(--sunken)" strokeWidth="6" />
      {total > 0 && (
        <g transform="rotate(-90 28 28)">
          <circle cx="28" cy="28" r="22" fill="none" stroke="var(--loss)" strokeWidth="6" />
          {share > 0 && <circle cx="28" cy="28" r="22" fill="none" stroke="var(--profit)" strokeWidth="6" pathLength={100} strokeDasharray={`${share} 100`} />}
        </g>
      )}
    </svg>
  );
}

/** Compact for a currency ("$7.06K"); R, % and pips keep their unit through money(). */
const compact = (n: number, display: string) => (display.length === 3 ? shortMoney(n, currencySymbol(display).trim()) : money(n, display));

const valueClass = "num text-[19px] leading-none font-semibold tracking-tight @[16rem]:text-[22px]";

export function KpiRow({ data, display, search }: { data: Analytics; display: string; search: string }) {
  const m = data.metrics;
  const days: [number, number, number] = [m.winningDays, m.tradingDays - m.winningDays - m.losingDays, m.losingDays];
  const trades: [number, number, number] = [m.wins, m.breakeven, m.losses];
  const avgWin = m.avgWin ?? 0;
  const avgLoss = Math.abs(m.avgLoss ?? 0);
  const winShare = avgWin + avgLoss ? (avgWin / (avgWin + avgLoss)) * 100 : 0;
  const all = journalHref(search, {});
  const by = (outcome: string) => journalHref(search, { outcome });
  return (
    // Columns follow the row's own width: five only when each card gets about 220 px, whatever the sidebar takes.
    <div className="@container" data-testid="kpi-row">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-[21px] @[34rem]:grid-cols-2 @[48rem]:grid-cols-3 @[74rem]:grid-cols-5">
      <KpiCard testId="kpi-net" label="Net P&L" info={`Realized, closed trades only: ${D.netPnl.formula}. ${D.netPnl.meaning}`}
        visual={
          <Link href={all} aria-label="Open the trades behind Net P&L" title="Open these trades" className="grid size-[30px] place-items-center rounded-control bg-accent-soft text-accent hover:bg-accent hover:text-accent-ink">
            <Icon d={ICONS.open} size={15} />
          </Link>
        }
      >
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cx(valueClass, m.netPnl > 0 ? "text-profit" : m.netPnl < 0 ? "text-loss" : "text-ink")} data-testid="kpi-net-value">{money(m.netPnl, display)}</span>
          <span className="num rounded-full bg-sunken px-1.5 text-[11px] leading-[17px] font-semibold text-ink-soft" title="Closed trades counted" data-testid="kpi-net-count">{m.closedTrades}</span>
        </p>
      </KpiCard>
      <KpiCard testId="kpi-winrate" label="Trade win %" info={`${D.winRate.formula}. Breakeven trades count in the total but are neither wins nor losses.`}
        visual={<div><Gauge parts={trades} label={`${m.wins} won, ${m.breakeven} breakeven, ${m.losses} lost`} /><Pills parts={trades} hrefs={[by("win"), by("breakeven"), by("loss")]} /></div>}
      >
        <Link href={all} className={cx(valueClass, "text-ink hover:underline")} data-testid="kpi-winrate-value">{pct(m.winRate, 2)}</Link>
      </KpiCard>
      <KpiCard testId="kpi-pf" label="Profit factor" info={`${D.profitFactor.formula}. Gross profit ${money(m.grossProfit, display)}, gross loss ${money(m.grossLoss, display)}.`}
        visual={<Ring profit={m.grossProfit} loss={m.grossLoss} />}
      >
        <Link href={all} className={cx(valueClass, "text-ink hover:underline")} data-testid="kpi-pf-value">{profitFactorText(m)}</Link>
        <p className="num mt-1.5 flex flex-wrap gap-x-1.5 text-[11px] text-muted"><span className="text-profit" data-testid="kpi-gross-profit">{money(m.grossProfit, display)}</span><span className="text-loss" data-testid="kpi-gross-loss">{money(-Math.abs(m.grossLoss), display)}</span></p>
      </KpiCard>
      <KpiCard testId="kpi-daywin" label="Day win %" info={`${D.dayWinRate.formula}. A day is the calendar day a trade closed, in your time zone.`}
        visual={<div><Gauge parts={days} label={`${days[0]} winning days, ${days[1]} breakeven, ${days[2]} losing`} /><Pills parts={days} /></div>}
      >
        <Link href="#calendar" className={cx(valueClass, "text-ink hover:underline")} data-testid="kpi-daywin-value">{pct(m.dayWinRate, 2)}</Link>
      </KpiCard>
      <KpiCard testId="kpi-avg" label="Avg win/loss" info={`Average winning trade ÷ |average losing trade|. ${D.avgWin.formula}; ${D.avgLoss.formula}.`}
        beside={
          <div data-testid="kpi-avg-bar">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`Average win ${money(m.avgWin, display)}, average loss ${money(m.avgLoss, display)}`}>
              <span className="bg-profit" style={{ width: `${winShare}%` }} />
              <span className="flex-1 bg-loss" style={{ display: avgLoss ? undefined : "none" }} />
            </div>
            <p className="num mt-1.5 flex justify-between text-[11px] font-medium">
              <Link href={by("win")} className="text-profit hover:underline">{m.avgWin === null ? "—" : compact(m.avgWin, display)}</Link>
              <Link href={by("loss")} className="text-loss hover:underline">{m.avgLoss === null ? "—" : compact(m.avgLoss, display)}</Link>
            </p>
          </div>
        }
      >
        <span className={cx(valueClass, "text-ink")} data-testid="kpi-avg-value">{m.payoffRatio === null ? (m.losses === 0 && m.wins > 0 ? "No losses" : "—") : m.payoffRatio.toFixed(2)}</span>
      </KpiCard>
      </div>
    </div>
  );
}

// ---------- the score ----------

function fmtRaw(a: ScoreAxis): string {
  if (a.raw === null) return "not known";
  if (a.key === "winRate") return pct(a.raw, 1);
  if (a.key === "consistency") return `best day is ${pct(a.raw, 1)} of winning-day profit`;
  if (a.key === "maxDrawdown") return `${a.raw.toFixed(2)} average losses deep`;
  return a.raw.toFixed(2);
}

export function ScoreCard({ data }: { data: Analytics }) {
  const s = data.score;
  const [picked, setPicked] = useState<number | null>(null);
  const [box, { width }] = useBoxSize<HTMLDivElement>({ width: 520, height: 0 });
  // Drawn at the card's own width, so labels stay 12 px; the radius gives way first, then labels take two lines.
  const W = Math.max(240, width);
  const stacked = W < 440;
  const r = Math.max(40, Math.min(92, (W - (stacked ? 200 : 250)) / 2));
  const H = 2 * r + (stacked ? 84 : 66);
  const c = { x: W / 2, y: H / 2 + 4 };
  const n = s.axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i / n) * 2 * Math.PI;
  const pt = (i: number, v: number) => [c.x + (v / 100) * r * Math.cos(angle(i)), c.y + (v / 100) * r * Math.sin(angle(i))] as const;
  const ring = (v: number) => s.axes.map((_, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");
  const known = s.axes.flatMap((a, i) => (a.value === null ? [] : [{ i, v: a.value }]));
  const axis = picked === null ? null : s.axes[picked];
  const closed = data.moneyMetrics.closedTrades;
  const days = data.moneyMetrics.tradingDays;
  return (
    <section className={cx(panel, "relative flex min-w-0 flex-col")} data-testid="score-card" aria-label="Jarvis Performance Score">
      <header className="flex h-11 items-center gap-1.5 border-b border-line px-4">
        <h2 className="text-[14px] font-semibold text-ink">Jarvis Performance Score</h2>
        <InfoTip label="the Jarvis Performance Score" text={`Six axes, each scaled 0 to 100 from stated anchors, then a weighted mean. Needs ${s.needs.trades} closed trades over ${s.needs.days} days. Select an axis for its inputs. Full method: docs/performance-score.md.`} />
      </header>
      <div className="relative flex-1 px-2">
        <div ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block" role="img" aria-label={`Radar of the six axes. ${s.axes.map((a) => `${a.label} ${a.value === null ? "not known" : a.value.toFixed(1)}`).join(", ")}.`}>
          {[20, 40, 60, 80, 100].map((v) => <polygon key={v} points={ring(v)} fill={v === 100 ? "var(--raised)" : "none"} stroke="var(--line)" />)}
          {s.axes.map((a, i) => {
            const [x, y] = pt(i, 100);
            return <line key={a.key} x1={c.x} y1={c.y} x2={x} y2={y} stroke="var(--line)" strokeDasharray={a.value === null ? "3 3" : undefined} />;
          })}
          {known.length > 2 && <polygon points={known.map(({ i, v }) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ")} fill="var(--accent)" fillOpacity="0.22" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />}
          {known.map(({ i, v }) => {
            const [x, y] = pt(i, v);
            return <circle key={i} cx={x} cy={y} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />;
          })}
          {s.axes.map((a, i) => {
            const [lx, ly] = pt(i, 122);
            const anchor = Math.abs(lx - c.x) < 4 ? "middle" : lx > c.x ? "start" : "end";
            return (
              <text
                key={a.key}
                x={lx}
                y={ly + 4}
                textAnchor={anchor}
                fontSize="12"
                fill={picked === i ? "var(--accent)" : "var(--ink-soft)"}
                className="cursor-pointer outline-none focus-visible:underline"
                tabIndex={0}
                role="button"
                aria-label={`${a.label}, ${a.value === null ? "not known" : a.value.toFixed(1)}. Show its inputs`}
                onClick={() => setPicked(picked === i ? null : i)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPicked(picked === i ? null : i))}
                data-testid={`score-axis-${a.key}`}
              >
                {stacked ? (
                  <>
                    <tspan x={lx} dy={ly < c.y - 4 ? -7 : ly > c.y + 4 ? 0 : -6}>{a.label}</tspan>
                    <tspan x={lx} dy="14">({a.value === null ? "—" : a.value.toFixed(1)})</tspan>
                  </>
                ) : (
                  `${a.label} (${a.value === null ? "—" : a.value.toFixed(1)})`
                )}
              </text>
            );
          })}
        </svg>
        </div>
        {axis && (
          <div className="absolute inset-x-3 bottom-2 rounded-control border border-line bg-surface p-3 text-[12.5px] shadow-xl" role="dialog" aria-label={`${axis.label} inputs`} data-testid="score-axis-detail">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-ink">{axis.label}: {axis.value === null ? "not scored" : axis.value.toFixed(1)} <span className="font-normal text-muted">weight {axis.weight}</span></p>
              <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="text-muted hover:text-ink">✕</button>
            </div>
            <p className="mt-1 text-ink-soft">Input: <span className="num">{fmtRaw(axis)}</span></p>
            <p className="num mt-0.5 text-muted">{axis.formula}</p>
            <p className="mt-0.5 text-muted">{axis.value === null && axis.missing ? axis.missing : axis.meaning}</p>
          </div>
        )}
      </div>
      <footer className="mx-4 flex items-center gap-4 border-t border-line py-3">
        <div className="min-w-[96px]">
          <p className="text-[11px] font-semibold text-ink-soft">Your score</p>
          <p className="num text-[22px] leading-tight font-semibold text-ink" data-testid="score-total">{s.score === null ? "—" : s.score.toFixed(2)}</p>
        </div>
        <div className="min-w-0 flex-1 border-l border-line pl-4">
          {s.score === null ? (
            <p className="text-[12px] text-muted" data-testid="score-pending">
              A score needs {s.needs.trades} closed trades over {s.needs.days} trading days. So far: {closed} over {days}.
            </p>
          ) : (
            <>
              <div className="relative h-1.5 rounded-full bg-sunken" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.score} aria-label="Score from 0 to 100">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--scale-low)] via-[var(--scale-mid)] to-[var(--scale-high)]" style={{ width: `${s.score}%` }} />
                <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-[var(--scale-high)] shadow" style={{ left: `${s.score}%` }} />
              </div>
              <p className="num mt-1.5 flex justify-between text-[10px] text-muted">{[0, 20, 40, 60, 80, 100].map((t) => <span key={t}>{t}</span>)}</p>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}

// ---------- charts ----------

const axisDate = (key: string) => `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(2, 4)}`;
const fullMoney = (n: number, display: string) => money(n, display).replace("−", "-");

function ChartCard({ title, info, children, action, testId }: { title: string; info: string; children: React.ReactNode; action?: React.ReactNode; testId: string }) {
  return (
    <section className={cx(panel, "flex min-h-[343px] min-w-0 flex-col")} data-testid={testId} aria-label={title}>
      <header className="flex h-11 items-center gap-1.5 border-b border-line px-4">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        <InfoTip label={title} text={info} />
        <span className="ml-auto">{action}</span>
      </header>
      <div className="min-h-0 flex-1 px-3 pt-3 pb-2">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="grid h-full min-h-[240px] place-items-center px-6 text-center text-[13px] text-muted">{text}</p>;
}

function Axes({ ticks, y, left, width, display, keys, x, height }: { ticks: number[]; y: (v: number) => number; left: number; width: number; display: string; keys: string[]; x: (i: number) => number; height: number }) {
  const slots = Math.max(1, Math.min(4, Math.floor((width - left) / 80)));
  const labels = keys.length <= 1 ? keys.map((_, i) => i) : Array.from({ length: slots + 1 }, (_, k) => Math.round((k / slots) * (keys.length - 1))).filter((v, i, a) => a.indexOf(v) === i);
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--line-strong)" : "var(--line)"} strokeDasharray={t === 0 ? undefined : "2 4"} />
          <text x={left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={LABEL} fill="var(--muted)">{fullMoney(t, display)}</text>
        </g>
      ))}
      {labels.map((i) => <text key={i} x={x(i)} y={height - 4} textAnchor={keys.length > 1 && i === 0 ? "start" : keys.length > 1 && i === keys.length - 1 ? "end" : "middle"} fontSize={LABEL} fill="var(--muted)">{axisDate(keys[i])}</text>)}
    </>
  );
}

function leftPad(ticks: number[], display: string) {
  return Math.max(40, ...ticks.map((t) => fullMoney(t, display).length * 6.2 + 12));
}

export function CumulativeCard({ data, display, dayHref, brush, rangeActive, clearRange }: { data: Analytics; display: string; dayHref: (key: string) => string; brush: (from: string, to: string) => void; rangeActive: boolean; clearRange: () => void }) {
  const router = useRouter();
  const series = useMemo(() => cumulativeByDay(data.periods.day), [data.periods.day]);
  const [box, { width }] = useBoxSize<HTMLDivElement>({ width: 520, height: 0 });
  const height = 290;
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const { active, setActive, focusProps } = useScrub(series.length, (i) => router.push(dayHref(series[i].key)));
  const vals = series.map((p) => p.cum);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const ticks = niceTicks(min, max, 7);
  const lo = Math.min(min, ticks[0] ?? min);
  const hi = Math.max(max, ticks.at(-1) ?? max);
  const pad = { l: leftPad(ticks, display), r: 8, t: 8, b: 22 };
  const x = (i: number) => pad.l + (series.length > 1 ? i / (series.length - 1) : 0.5) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(series.length - 1, Math.round(((e.clientX - b.left - pad.l) / (b.width - pad.l - pad.r)) * (series.length - 1))));
  };
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join("");
  const area = series.length ? `${line}L${x(series.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z` : "";
  const h = active !== null ? series[active] : null;
  const zero = y(0);
  return (
    <ChartCard
      testId="cumulative-card"
      title="Daily Net Cumulative P&L"
      info="Realized only: the running total of closed trades' net P&L, one point per day a trade closed, in your time zone. Floating P&L is never included. Drag across the chart to zoom to the trades closed on those days; select a point to open that day."
      action={rangeActive ? <button type="button" onClick={clearRange} className="text-[12px] font-medium text-accent hover:underline">Reset zoom</button> : null}
    >
      <div ref={box} className="relative h-full">
        {series.length === 0 ? (
          <Empty text="No closed trades in these filters yet. The line starts with the first closed trade." />
        ) : (
          <>
            <svg
              width={width}
              height={height}
              className="block touch-pan-y select-none"
              role="img"
              aria-label={`Cumulative realized P&L over ${series.length} trading days, ending at ${money(series.at(-1)!.cum, display)}.`}
              {...focusProps}
              onPointerDown={(e) => {
                // Captured, so a release outside the chart still ends the drag here.
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ a: at(e), b: at(e) });
              }}
              onPointerCancel={() => setDrag(null)}
              onLostPointerCapture={() => setDrag(null)}
              onPointerMove={(e) => {
                const i = at(e);
                setActive(i);
                if (drag) setDrag({ ...drag, b: i });
              }}
              onPointerUp={(e) => {
                const i = at(e);
                if (drag && Math.abs(drag.a - i) >= 1) {
                  const [a, b] = [Math.min(drag.a, i), Math.max(drag.a, i)];
                  brush(series[a].key, series[b].key);
                } else router.push(dayHref(series[i].key));
                setDrag(null);
              }}
              style={{ ...focusProps.style, cursor: "crosshair" }}
              data-testid="cumulative-chart"
            >
              <defs>
                <linearGradient id="cum-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--profit)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--profit)" stopOpacity="0.04" />
                </linearGradient>
                <clipPath id="cum-above"><rect x="0" y="0" width={width} height={Math.max(0, zero)} /></clipPath>
                <clipPath id="cum-below"><rect x="0" y={zero} width={width} height={Math.max(0, height - zero)} /></clipPath>
              </defs>
              <Axes ticks={ticks} y={y} left={pad.l} width={width - pad.r} display={display} keys={series.map((p) => p.key)} x={x} height={height} />
              <path d={area} fill="url(#cum-fill)" clipPath="url(#cum-above)" />
              <path d={area} fill="var(--loss)" fillOpacity="0.08" clipPath="url(#cum-below)" />
              <path d={line} fill="none" stroke="var(--profit)" strokeWidth="1.6" strokeLinejoin="round" clipPath="url(#cum-above)" />
              <path d={line} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" clipPath="url(#cum-below)" />
              {drag && drag.a !== drag.b && <rect x={x(Math.min(drag.a, drag.b))} y={pad.t} width={Math.abs(x(drag.b) - x(drag.a))} height={height - pad.t - pad.b} fill="var(--accent)" fillOpacity="0.1" stroke="var(--accent)" strokeOpacity="0.4" />}
              {h && active !== null && (
                <>
                  <line x1={x(active)} x2={x(active)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" />
                  <circle cx={x(active)} cy={y(h.cum)} r="4" fill={h.cum >= 0 ? "var(--profit)" : "var(--ink)"} stroke="var(--surface)" strokeWidth="2" />
                </>
              )}
            </svg>
            {h && active !== null && (
              <Tip x={x(active)} width={width}>
                <span className="block text-muted">{axisDate(h.key)}</span>
                <span className="num block font-semibold text-ink">{money(h.cum, display)}</span>
                <span className={cx("num block", h.pnl >= 0 ? "text-profit" : "text-loss")}>Day {money(h.pnl, display, true)}</span>
              </Tip>
            )}
          </>
        )}
      </div>
    </ChartCard>
  );
}

export function DailyCard({ data, display, dayHref }: { data: Analytics; display: string; dayHref: (key: string) => string }) {
  const router = useRouter();
  const rows = data.periods.day;
  const [box, { width }] = useBoxSize<HTMLDivElement>({ width: 520, height: 0 });
  const height = 290;
  const { active, setActive, focusProps } = useScrub(rows.length, (i) => router.push(dayHref(rows[i].key)));
  const min = Math.min(0, ...rows.map((r) => r.pnl));
  const max = Math.max(0, ...rows.map((r) => r.pnl));
  const ticks = niceTicks(min, max, 7);
  const lo = Math.min(min, ticks[0] ?? min);
  const hi = Math.max(max, ticks.at(-1) ?? max);
  const pad = { l: leftPad(ticks, display), r: 8, t: 8, b: 22 };
  const step = (width - pad.l - pad.r) / Math.max(1, rows.length);
  const w = Math.max(1, Math.min(18, step * 0.7));
  const x = (i: number) => pad.l + i * step + step / 2;
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const slot = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.floor(((e.clientX - b.left - pad.l) / (b.width - pad.l - pad.r)) * rows.length)));
  };
  const h = active !== null ? rows[active] : null;
  return (
    <ChartCard testId="daily-card" title="Net Daily P&L" info="Realized net P&L of the trades closed on each day, in your time zone. Days with no closed trade are left out. Select a bar to open that day's journal.">
      <div ref={box} className="relative h-full">
        {rows.length === 0 ? (
          <Empty text="No closed trades in these filters yet. Each day with a closed trade gets a bar." />
        ) : (
          <>
            <svg width={width} height={height} className="block touch-pan-y" role="img" aria-label={`Net P&L for ${rows.length} trading days. Enter opens the chosen day.`} {...focusProps} onPointerMove={(e) => setActive(slot(e))} onClick={(e) => router.push(dayHref(rows[slot(e)].key))} style={{ ...focusProps.style, cursor: "pointer" }} data-testid="daily-chart">
              <Axes ticks={ticks} y={y} left={pad.l} width={width - pad.r} display={display} keys={rows.map((r) => r.key)} x={x} height={height} />
              {rows.map((r, i) => (
                <rect key={r.key} data-bar={r.key} x={x(i) - w / 2} y={Math.min(y(r.pnl), y(0))} width={w} height={Math.max(1, Math.abs(y(r.pnl) - y(0)))} rx={w > 4 ? 1.5 : 0} fill={r.pnl > 0 ? "var(--profit)" : r.pnl < 0 ? "var(--loss)" : "var(--line-strong)"} opacity={active === null || active === i ? 1 : 0.55} />
              ))}
            </svg>
            {h && active !== null && (
              <Tip x={x(active)} width={width}>
                <span className="block text-muted">{axisDate(h.key)}</span>
                <span className={cx("num block font-semibold", h.pnl > 0 ? "text-profit" : h.pnl < 0 ? "text-loss" : "text-ink")}>{money(h.pnl, display, true)}</span>
                <span className="block text-ink-soft">{h.trades} {h.trades === 1 ? "trade" : "trades"}, {h.wins} won, {h.losses} lost</span>
              </Tip>
            )}
          </>
        )}
      </div>
    </ChartCard>
  );
}

// ---------- recent trades and open positions ----------

export interface LivePosition {
  key: string;
  kind: "mt5" | "manual";
  accountId: number;
  accountName: string;
  currency: string | null;
  stale: boolean;
  syncedAt: string | null;
  symbol: string;
  instrument: string;
  side: "long" | "short";
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  floatingPnl: number | null;
  openedAt: string | null;
  tradeId: number | null;
}

const OPTIONAL_COLUMNS = [
  ["instrument", "Instrument"],
  ["side", "Direction"],
  ["entry", "Entry price"],
  ["current", "Current price"],
  ["size", "Size"],
  ["sl", "Stop loss"],
  ["tp", "Take profit"],
  ["account", "Account"],
] as const;
type Column = (typeof OPTIONAL_COLUMNS)[number][0];
const COLUMNS_KEY = "jarvis-position-columns";
const TAB_KEY = "jarvis-dash-tab";

const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "—");
const price = (n: number | null) => (n === null || n === 0 ? "—" : String(n));
const th = "px-2 py-2 text-center text-[11px] font-semibold text-ink-soft";
const td = "px-2 py-2.5 text-center text-[12.5px]";

function PositionDetail({ p, onClose }: { p: LivePosition | null; onClose: () => void }) {
  return (
    <Dialog open={p !== null} onClose={onClose} title={p ? `${p.symbol} ${p.side === "long" ? "long" : "short"}, ${p.accountName}` : ""}>
      {p && (
        <div data-testid="position-detail">
          <p className={cx("mb-3 rounded-control px-3 py-2 text-[13px]", p.kind === "manual" ? "bg-sunken text-ink-soft" : p.stale ? "bg-warn-soft text-ink" : "bg-profit-soft text-ink")}>
            {p.kind === "manual" ? "Entered by hand. No live price is available for this account, so there's no current price or floating P&L." : p.stale ? `Stale: from the MT5 sync at ${dateTime(p.syncedAt)}. Prices may have moved since.` : `From MT5, synced ${dateTime(p.syncedAt)}.`}
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px]">
            {[
              ["Opened", dateTime(p.openedAt)],
              ["Instrument", p.instrument],
              ["Direction", p.side === "long" ? "Long" : "Short"],
              ["Size", String(p.volume)],
              ["Entry price", price(p.entryPrice)],
              ["Current price", p.currentPrice === null ? "Unavailable" : String(p.currentPrice)],
              ["Stop loss", price(p.stopLoss)],
              ["Take profit", price(p.takeProfit)],
              ["Floating P&L", p.floatingPnl === null ? "Unavailable" : money(p.floatingPnl, p.currency ?? "USD", true)],
              ["Account", p.accountName],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="num text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Dialog>
  );
}

export function TradesCard({ recent, accounts, positions, openTrade, search }: { recent: Trade[]; accounts: Account[]; positions: LivePosition[] | null; openTrade: (id: number) => void; search: string }) {
  const [storedTab, pick] = useStored(TAB_KEY, "recent");
  const tab = storedTab === "open" ? "open" : "recent";
  const [storedCols, setCols] = useStored(COLUMNS_KEY, "");
  const cols = storedCols.split(",").filter((k): k is Column => OPTIONAL_COLUMNS.some(([id]) => id === k));
  const [detail, setDetail] = useState<LivePosition | null>(null);
  const toggle = (c: Column) => setCols((cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c]).join(","));
  const on = (c: Column) => cols.includes(c);
  const stale = positions?.some((p) => p.kind === "mt5" && p.stale);
  const lastSync = positions?.filter((p) => p.kind === "mt5").map((p) => p.syncedAt ?? "").sort().at(-1);
  const currencyOf = (id: number) => accounts.find((a) => a.id === id)?.currency;

  return (
    <section className={cx(panel, "flex min-w-0 flex-col")} data-testid="trades-card" aria-label="Recent trades and open positions">
      <header className="flex items-center gap-5 border-b border-line px-4" role="tablist" aria-label="Trades">
        {(["recent", "open"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => pick(t)} className={cx("-mb-px h-11 border-b-2 text-[12px] font-semibold tracking-wide uppercase", tab === t ? "border-accent text-accent" : "border-transparent text-ink-soft hover:text-ink")}>
            {t === "recent" ? "Recent trades" : `Open positions${positions?.length ? ` (${positions.length})` : ""}`}
          </button>
        ))}
        {tab === "open" && (
          <Dropdown label="Choose position columns" className="ml-auto grid size-8 place-items-center rounded-control text-ink-soft hover:bg-raised" button={<Icon d={ICONS.gear} size={16} />} panelClassName="w-52">
            {() => (
              <fieldset>
                <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">Columns</legend>
                <p className="mb-1 text-[12px] text-muted">Open date, symbol and P&amp;L always show.</p>
                {OPTIONAL_COLUMNS.map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2 py-1 text-[13px] text-ink">
                    <input type="checkbox" checked={on(id)} onChange={() => toggle(id)} className="accent-[var(--accent)]" />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
          </Dropdown>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-x-auto p-2">
        {tab === "recent" ? (
          recent.length === 0 ? (
            <Empty text="No closed trades in these filters." />
          ) : (
            <table className="w-full" data-testid="recent-trades">
              <thead>
                <tr className="bg-sunken [&>th:first-child]:rounded-l-control [&>th:last-child]:rounded-r-control">
                  <th scope="col" className={th}>Close date</th>
                  <th scope="col" className={th}>Symbol</th>
                  <th scope="col" className={th}>Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-raised" onClick={() => openTrade(t.id)}>
                    <td className={cx(td, "num text-ink-soft")}>{shortDate(t.closedAt)}</td>
                    <td className={cx(td, "font-medium text-ink")}><button type="button" onClick={(e) => (e.stopPropagation(), openTrade(t.id))} className="hover:underline">{t.symbol}</button></td>
                    <td className={cx(td, "num font-medium", (t.pnl ?? 0) > 0 ? "text-profit" : (t.pnl ?? 0) < 0 ? "text-loss" : "text-ink")}>{t.pnlStatus !== "ok" ? "Pending" : money(t.pnl, currencyOf(t.accountId))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : positions === null ? (
          <Empty text="Loading positions…" />
        ) : positions.length === 0 ? (
          <Empty text="No open positions in these filters. Live positions come from connected MT5 accounts; open trades you entered by hand show here too." />
        ) : (
          <>
            <p className={cx("mb-2 rounded-control px-2.5 py-1.5 text-[12px]", stale ? "bg-warn-soft text-ink" : "bg-sunken text-ink-soft")} data-testid="positions-status">
              Live account data, separate from the realized figures above. {lastSync ? (stale ? `Stale: last MT5 sync ${dateTime(lastSync)}.` : `MT5 synced ${dateTime(lastSync)}.`) : ""} {positions.some((p) => p.kind === "manual") ? "Accounts entered by hand have no live price." : ""}
            </p>
            <table className="w-full" data-testid="open-positions">
              <thead>
                <tr className="bg-sunken [&>th:first-child]:rounded-l-control [&>th:last-child]:rounded-r-control">
                  <th scope="col" className={th}>Open date</th>
                  {on("instrument") && <th scope="col" className={th}>Instrument</th>}
                  <th scope="col" className={th}>Symbol</th>
                  {on("side") && <th scope="col" className={th}>Direction</th>}
                  {on("entry") && <th scope="col" className={th}>Entry</th>}
                  {on("current") && <th scope="col" className={th}>Current</th>}
                  {on("size") && <th scope="col" className={th}>Size</th>}
                  {on("sl") && <th scope="col" className={th}>SL</th>}
                  {on("tp") && <th scope="col" className={th}>TP</th>}
                  <th scope="col" className={th}>Floating P&amp;L</th>
                  {on("account") && <th scope="col" className={th}>Account</th>}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.key} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-raised" onClick={() => (p.tradeId ? openTrade(p.tradeId) : setDetail(p))}>
                    <td className={cx(td, "num text-ink-soft")}>{shortDate(p.openedAt)}</td>
                    {on("instrument") && <td className={td}>{p.instrument}</td>}
                    <td className={cx(td, "font-medium text-ink")}><button type="button" onClick={(e) => (e.stopPropagation(), p.tradeId ? openTrade(p.tradeId) : setDetail(p))} className="hover:underline">{p.symbol}</button></td>
                    {on("side") && <td className={td}>{p.side === "long" ? "Long" : "Short"}</td>}
                    {on("entry") && <td className={cx(td, "num")}>{price(p.entryPrice)}</td>}
                    {on("current") && <td className={cx(td, "num", p.currentPrice === null && "text-muted")}>{p.currentPrice === null ? "Unavailable" : p.currentPrice}</td>}
                    {on("size") && <td className={cx(td, "num")}>{p.volume}</td>}
                    {on("sl") && <td className={cx(td, "num")}>{price(p.stopLoss)}</td>}
                    {on("tp") && <td className={cx(td, "num")}>{price(p.takeProfit)}</td>}
                    <td className={cx(td, "num font-medium", p.floatingPnl === null ? "text-muted" : p.floatingPnl > 0 ? "text-profit" : p.floatingPnl < 0 ? "text-loss" : "text-ink")}>
                      {p.floatingPnl === null ? "Price unavailable" : money(p.floatingPnl, p.currency ?? "USD")}
                      {p.kind === "mt5" && p.stale && <span className="ml-1 rounded-[3px] bg-warn-soft px-1 text-[10px] text-warn">stale</span>}
                    </td>
                    {on("account") && <td className={td}>{p.accountName}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {tab === "recent" && recent.length > 0 && (
        <Link href={journalHref(search, { sort: "closedAt" })} className="mb-3 self-center text-[12px] font-medium text-ink-soft hover:text-accent hover:underline">View more</Link>
      )}
      <PositionDetail p={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

// ---------- the month calendar ----------

const MONTH_KEY = "jarvis-dash-month";
const CAL_KEY = "jarvis-dash-calendar";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthCalendar({ data, display, dayHref, today }: { data: Analytics; display: string; dayHref: (key: string) => string; today: string }) {
  const [stored, go] = useStored(MONTH_KEY, "");
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(stored) ? stored : today.slice(0, 7);
  const [options, setOptions] = useStored(CAL_KEY, "");
  const show = { trades: !options.includes("-trades"), winRate: !options.includes("-win") };
  const setOption = (k: "trades" | "winRate", v: boolean) => {
    const next = { ...show, [k]: v };
    setOptions(`${next.trades ? "" : "-trades"}${next.winRate ? "" : "-win"}`);
  };
  const [y, m] = month.split("-").map(Number);
  const grid = monthGrid(y, m);
  const days = useMemo(() => new Map<string, DayResult>(data.periods.day.map((r) => [r.key, r])), [data.periods.day]);
  const weeks = weekSummaries(grid, days);
  const stats = monthStats(y, m, days);
  const biggest = Math.max(0, ...grid.flat().filter((c) => c.inMonth).map((c) => Math.abs(days.get(c.key)?.pnl ?? 0)));
  const fmt = (n: number) => compact(n, display);
  const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section id="calendar" className={cx(panel, "min-w-0 scroll-mt-20 p-4")} data-testid="month-calendar" aria-label={`Trading calendar, ${title}`}>
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Previous month" className="grid size-7 place-items-center rounded-control text-ink-soft hover:bg-raised"><Icon d={ICONS.left} size={14} /></button>
        <h2 className="min-w-[120px] text-center text-[14px] font-semibold text-ink" data-testid="calendar-month">{title}</h2>
        <button type="button" onClick={() => go(shiftMonth(month, 1))} aria-label="Next month" className="grid size-7 place-items-center rounded-control text-ink-soft hover:bg-raised"><Icon d={ICONS.right} size={14} /></button>
        <button type="button" onClick={() => go(today.slice(0, 7))} className="h-[30px] rounded-control border border-line-strong px-3 text-[12.5px] font-medium text-ink hover:bg-raised">This month</button>
        <div className="ml-auto flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-ink">Monthly stats:</span>
          <span className={cx("num rounded-control px-2 py-0.5 font-medium", stats.pnl > 0 ? "bg-profit-soft text-profit" : stats.pnl < 0 ? "bg-loss-soft text-loss" : "bg-sunken text-ink-soft")} data-testid="month-pnl">{fmt(stats.pnl)}</span>
          <span className="num rounded-control bg-sunken px-2 py-0.5 font-medium text-ink-soft" data-testid="month-days">{stats.days} {stats.days === 1 ? "day" : "days"}</span>
          <Dropdown label="Calendar settings" className="grid size-7 place-items-center rounded-control text-ink-soft hover:bg-raised" button={<Icon d={ICONS.gear} size={15} />} panelClassName="w-52">
            {() => (
              <fieldset className="text-[13px]">
                <legend className="mb-1 font-semibold text-ink">Show in each day</legend>
                <label className="flex items-center gap-2 py-1"><input type="checkbox" className="accent-[var(--accent)]" checked={show.trades} onChange={(e) => setOption("trades", e.target.checked)} /> Number of trades</label>
                <label className="flex items-center gap-2 py-1"><input type="checkbox" className="accent-[var(--accent)]" checked={show.winRate} onChange={(e) => setOption("winRate", e.target.checked)} /> Win rate</label>
              </fieldset>
            )}
          </Dropdown>
          <InfoTip label="the calendar" text="Each day is the realized net P&L of trades that closed that day, in your time zone. Weeks run Sunday to Saturday; a week's total counts only its days in this month. Select a day to open its journal." />
        </div>
      </header>
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 md:grid-cols-[repeat(7,minmax(0,1fr))_minmax(92px,0.95fr)]">
        {WEEKDAYS.map((d) => <div key={d} className="rounded-control border border-line py-1.5 text-center text-[12px] font-semibold text-ink-soft">{d}</div>)}
        <div className="hidden md:block" />
        {grid.map((row, r) => [
          ...row.map((c) => {
            const d = c.inMonth ? days.get(c.key) : undefined;
            const strong = d && biggest > 0 && Math.abs(d.pnl) >= biggest * 0.6;
            const fill = !c.inMonth ? "bg-transparent border-transparent" : !d ? "bg-sunken/70 border-transparent" : d.pnl > 0 ? (strong ? "bg-profit-strong border-profit/30" : "bg-profit-soft border-profit/20") : d.pnl < 0 ? (strong ? "bg-loss-strong border-loss/40" : "bg-loss-soft border-loss/30") : "bg-sunken border-line";
            const isToday = c.key === today;
            const label = `${c.key}${d ? `: ${money(d.pnl, display)}, ${d.trades} ${d.trades === 1 ? "trade" : "trades"}, ${pct(d.trades ? d.wins / d.trades : null, 1)} won` : ", no trades"}. Open the daily journal`;
            const body = (
              <>
                <span className={cx("num absolute top-1.5 right-2 text-[11px]", isToday ? "grid size-5 place-items-center rounded-full bg-accent font-semibold text-accent-ink" : "text-ink-soft")}>{c.day}</span>
                {d && (
                  <span className="mt-auto block text-right">
                    <span className="num block text-[13px] leading-tight font-bold text-ink sm:text-[14px]" data-testid="day-pnl">{fmt(d.pnl)}</span>
                    {show.trades && <span className="num hidden text-[10.5px] leading-tight text-ink-soft sm:block">{d.trades} {d.trades === 1 ? "trade" : "trades"}</span>}
                    {show.winRate && <span className="num hidden text-[10.5px] leading-tight text-ink-soft sm:block">{(d.trades ? (d.wins / d.trades) * 100 : 0).toFixed(1)}%</span>}
                  </span>
                )}
              </>
            );
            const cls = cx("relative flex min-h-[64px] flex-col rounded-[5px] border p-1.5 sm:min-h-[88px] sm:p-2", fill);
            return c.inMonth ? (
              <Link key={c.key} href={dayHref(c.key)} aria-label={label} className={cx(cls, "hover:ring-2 hover:ring-accent/40")} data-day={c.key}>{body}</Link>
            ) : (
              <div key={c.key} className={cls} aria-hidden />
            );
          }),
          <div key={`w${r}`} className="hidden flex-col justify-center rounded-[5px] border border-line bg-surface px-3 py-2 md:flex" data-testid="week-summary">
            <span className="text-[11px] text-muted">Week {weeks[r].index}</span>
            <span className={cx("num text-[15px] font-semibold", weeks[r].pnl > 0 ? "text-profit" : weeks[r].pnl < 0 ? "text-loss" : "text-ink")}>{fmt(weeks[r].pnl)}</span>
            <span className="num mt-1 self-start rounded-full bg-sunken px-2 text-[10.5px] leading-[17px] text-ink-soft">{weeks[r].days} {weeks[r].days === 1 ? "day" : "days"}</span>
          </div>,
        ])}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 md:hidden" aria-label="Weekly totals">
        {weeks.map((w) => (
          <li key={w.index} className="flex items-center justify-between rounded-[5px] border border-line px-3 py-2 text-[12px]">
            <span className="text-muted">Week {w.index} <span className="text-[11px]">({w.days} {w.days === 1 ? "day" : "days"})</span></span>
            <span className={cx("num font-semibold", w.pnl > 0 ? "text-profit" : w.pnl < 0 ? "text-loss" : "text-ink")}>{fmt(w.pnl)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
