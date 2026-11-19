"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Positioning as Data } from "@/lib/server/market/cot";
import { FACTOR_LABELS } from "@/lib/domain/macro";
import { Sparkline } from "@/components/charts";
import { Card, CardHeader, Notice, Spinner, cx } from "@/components/ui";

const signed = (n: number, digits = 0) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: digits })}`;

/** −1…+1 as a bar growing left or right from the middle. */
function ScoreBar({ score }: { score: number }) {
  const w = Math.min(50, Math.abs(score) * 50);
  return (
    <span aria-hidden className="relative block h-1.5 w-20 rounded-full bg-line">
      <span className="absolute inset-y-0 left-1/2 w-px bg-muted" />
      <span className={cx("absolute inset-y-0 rounded-full", score >= 0 ? "left-1/2 bg-profit" : "right-1/2 bg-loss")} style={{ width: `${w}%` }} />
    </span>
  );
}

/** Jarvis's own scorecard from the CFTC's weekly Commitments of Traders report: real data, unlike the rest of this page. */
export function Positioning() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Data>("/api/market/positioning").then(setData).catch((e) => setError(e.message));
  }, []);

  // Daily prices are read from MT5 in the background: ask again until they're in.
  const reading = data?.prices.status === "reading";
  useEffect(() => {
    if (!reading) return;
    const id = setTimeout(() => api<Data>("/api/market/positioning").then(setData).catch(() => {}), 10_000);
    return () => clearTimeout(id);
  }, [reading, data]);

  return (
    <Card className="mb-6" data-testid="positioning">
      <CardHeader
        title="Speculator positioning"
        subtitle={data?.asOf ? `CFTC Commitments of Traders, positions as of ${new Date(data.asOf + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. Real data, updated weekly.` : "CFTC Commitments of Traders, updated weekly."}
      />
      {error && <Notice tone="loss">Couldn&rsquo;t load positioning: {error}</Notice>}
      {!data && !error && <Spinner label="Loading the CFTC report" />}
      {data?.notice && <Notice>{data.notice}</Notice>}
      {data && data.assets.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
          <section>
            <h3 className="mb-1 text-[13px] font-medium text-muted">Pairs</h3>
            <ul className="divide-y divide-line border-t border-line">
              {data.pairs.map((p) => (
                <li key={p.symbol} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 text-[13.5px]">
                  <span className="font-medium">{p.symbol}</span>
                  <ScoreBar score={p.score} />
                  <span className="text-right text-ink-soft"><span className="capitalize">{p.bias}</span> <span className="num">{signed(p.score, 2)}</span></span>
                  {(p.macro !== null || p.surprise !== null || p.seasonal !== null || p.trend !== null) && (
                    <span className="col-span-3 text-[12px] text-muted">
                      Positioning <span className="num">{signed(p.cot, 2)}</span>
                      {p.macro !== null && <>, macro <span className="num">{signed(p.macro, 2)}</span></>}
                      {p.surprise !== null && <>, surprises <span className="num">{signed(p.surprise, 2)}</span></>}
                      {p.seasonal !== null && <>, seasonality <span className="num">{signed(p.seasonal, 2)}</span></>}
                      {p.trend !== null && <>, trend <span className="num">{signed(p.trend, 2)}</span></>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="min-w-0 overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">Large speculators&rsquo; net position in each market</caption>
              <thead className="text-left text-[12.5px] text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="py-1.5 pr-3 font-normal">Market</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-normal" title="Net long minus short, as a share of all open contracts">Net</th>
                  <th scope="col" className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">This week</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-normal" title="Where this week's net sits between its 3-year low (0) and high (100)">COT index</th>
                  <th scope="col" className="hidden py-1.5 font-normal md:table-cell"><span className="sr-only">Net position over the last year</span></th>
                </tr>
              </thead>
              <tbody>
                {data.assets.map((a) => (
                  <tr key={a.key} className="border-b border-line">
                    <td className="py-1.5 pr-3">
                      <span className="font-medium">{a.key}</span> <span className="text-[12.5px] text-muted">{a.name}</span>
                      {a.date !== data.asOf && <span className="block text-[12px] text-warn">Last report {a.date}</span>}
                    </td>
                    <td className="num py-1.5 pr-3 text-right">{signed(a.netPct, 1)}%</td>
                    <td className={cx("num hidden py-1.5 pr-3 text-right sm:table-cell", a.weeklyChange === null ? "text-[12.5px] text-muted" : a.weeklyChange > 0 ? "text-profit" : a.weeklyChange < 0 ? "text-loss" : "text-muted")} title={a.weeklyChange === null ? "The report a week before is missing" : undefined}>
                      {a.weeklyChange === null ? "not available" : signed(a.weeklyChange)}
                    </td>
                    <td className="num py-1.5 pr-3 text-right">
                      {a.cotIndex}
                      {a.crowded && <span className="ml-1.5 text-[12px] text-warn">crowded</span>}
                    </td>
                    <td className="hidden py-1.5 md:table-cell"><Sparkline values={a.history} up={(a.weeklyChange ?? 0) >= 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {data?.macro.notice && <div className="mt-4"><Notice>{data.macro.notice}</Notice></div>}
      {data && data.macro.currencies.length > 0 && <MacroTable macro={data.macro} />}
      {data && <SurpriseTable surprises={data.surprises} />}
      {data && <PricesTable prices={data.prices} />}
      {data && !data.macro.configured && (
        <p className="mt-4 text-[13px] text-ink-soft">
          Add a free FRED key in <Link href="/settings#market-data" className="underline underline-offset-2">Settings, Market data</Link> to blend each economy&rsquo;s interest rate, growth and jobs into the pairs. Only the owner of this Jarvis can add it.
        </p>
      )}
      {data && (
        <p className="mt-4 text-[12.5px] text-muted">
          Positioning is non-commercial (large speculator) futures positions. A pair scores its base against its quote: positive means speculators, and whatever else is scored, favour the base.{data.surprises.some((x) => x.score !== null) && " Surprises weigh each release from the last 30 days on your calendar as a beat or a miss against its forecast, high impact three times low; for unemployment and jobless claims, lower is the beat."}{data.prices.pairs.length > 0 && " Seasonality is how this calendar month went in past full years (at least five); trend is where the latest close sits against its 20, 50 and 200-day averages."}{data.macro.currencies.length > 0 && " Macro compares the eight economies with each other: higher rates, hikes, growth and falling unemployment score higher. FRED has no current euro area unemployment rate, so the euro is scored without it."} Crowded means the top or bottom tenth of the 3-year range, where positioning has the least room left. Context for your review, not a signal to trade.
        </p>
      )}
    </Card>
  );
}

const reading = (v: number | null, unit: string) => (v === null ? "not available" : `${unit === "%" ? `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}` : signed(v, 2)}${unit}`);

/** Each economy's FRED readings and where they rank. */
function MacroTable({ macro }: { macro: Data["macro"] }) {
  const units = { rate: "%", rateTrend: " pt", growth: "%", jobs: " pt" } as const;
  return (
    <section className="mt-6 min-w-0 overflow-x-auto">
      <h3 className="mb-1 text-[13px] font-medium text-muted">Macro, from FRED</h3>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Each economy&rsquo;s interest rate, growth and jobs, and its macro score</caption>
        <thead className="text-left text-[12.5px] text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 pr-3 font-normal">Currency</th>
            {macro.currencies[0].factors.map((f) => (
              <th key={f.id} scope="col" className="py-1.5 pr-3 text-right font-normal">{FACTOR_LABELS[f.id]}</th>
            ))}
            <th scope="col" className="py-1.5 text-right font-normal" title="−1 to +1, against the other economies">Score</th>
          </tr>
        </thead>
        <tbody>
          {macro.currencies.map((c) => (
            <tr key={c.key} className="border-b border-line">
              <td className="py-1.5 pr-3 font-medium">{c.key}</td>
              {c.factors.map((f) => (
                <td key={f.id} className={cx("num whitespace-nowrap py-1.5 pr-3 text-right", f.value === null && "text-[12.5px] text-muted")} title={f.date ? `Latest reading: ${f.date}` : undefined}>
                  {reading(f.value, units[f.id])}
                </td>
              ))}
              <td className={cx("num py-1.5 text-right", c.score === null ? "text-muted" : c.score > 0 ? "text-profit" : c.score < 0 ? "text-loss" : undefined)}>{c.score === null ? "none" : signed(c.score, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** This user's calendar: beats and misses against forecast per currency, last 30 days. */
function SurpriseTable({ surprises }: { surprises: Data["surprises"] }) {
  const scored = surprises.filter((x) => x.score !== null);
  if (!scored.length)
    return (
      <p className="mt-4 text-[13px] text-ink-soft">
        Import or add events with actual and forecast figures on the <Link href="/news" className="underline underline-offset-2">Economic calendar</Link> to score how each currency&rsquo;s releases came in over the last 30 days.
      </p>
    );
  return (
    <section className="mt-6 min-w-0 overflow-x-auto">
      <h3 className="mb-1 text-[13px] font-medium text-muted">Economic surprises, last 30 days, from your calendar</h3>
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">How each currency&rsquo;s releases came in against forecast</caption>
        <thead className="text-left text-[12.5px] text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 pr-3 font-normal">Currency</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Beat</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Missed</th>
            <th scope="col" className="hidden py-1.5 pr-3 font-normal md:table-cell md:w-1/2">Latest</th>
            <th scope="col" className="py-1.5 text-right font-normal" title="−1 to +1: every release beat (+1) or missed (−1), weighted by impact">Score</th>
          </tr>
        </thead>
        <tbody>
          {scored.map((c) => {
            const r = c.releases[0];
            return (
              <tr key={c.key} className="border-b border-line">
                <td className="py-1.5 pr-3 font-medium">{c.key}</td>
                <td className="num py-1.5 pr-3 text-right">{c.beats}</td>
                <td className="num py-1.5 pr-3 text-right">{c.misses}</td>
                <td className="hidden max-w-0 truncate py-1.5 pr-3 text-ink-soft md:table-cell" title={`${r.title}: ${r.actual} against ${r.forecast} forecast`}>
                  {r.title}: <span className="num">{r.actual}</span> vs <span className="num">{r.forecast}</span>, {r.result === "inline" ? "in line" : r.result === "beat" ? "beat" : "missed"}
                </td>
                <td className={cx("num py-1.5 text-right", c.score! > 0 ? "text-profit" : c.score! < 0 ? "text-loss" : undefined)}>{signed(c.score!, 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const side = (v: boolean | null) => (v === null ? "not enough data" : v ? "above" : "below");

/** Each pair's past record in this month, and where it sits against its averages, from the user's broker. */
function PricesTable({ prices }: { prices: Data["prices"] }) {
  if (!prices.pairs.length)
    return (
      <p className="mt-4 text-[13px] text-ink-soft">
        {prices.status === "reading" ? "Reading daily prices from your MT5 account for seasonality and trend…" : (prices.notice ?? "Seasonality and trend come from daily prices in a connected MT5 account.")}
        {prices.status !== "reading" && <> Connect one under <Link href="/accounts" className="underline underline-offset-2">Accounts</Link>.</>}
      </p>
    );
  const month = MONTHS[new Date().getMonth()];
  return (
    <section className="mt-6 min-w-0 overflow-x-auto">
      <h3 className="mb-1 text-[13px] font-medium text-muted">Seasonality and trend, from your broker&rsquo;s daily prices</h3>
      {prices.status === "reading" && <p className="mb-1 text-[12.5px] text-muted">Still reading some pairs from MT5&hellip;</p>}
      {prices.notice && <p className="mb-1 text-[12.5px] text-muted">{prices.notice}</p>}
      <table className="w-full text-[13.5px]">
        <caption className="sr-only">Each pair&rsquo;s record in {month} of past years, and its trend</caption>
        <thead className="text-left text-[12.5px] text-muted">
          <tr className="border-b border-line">
            <th scope="col" className="py-1.5 pr-3 font-normal">Pair</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">{month}, years up</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">Average</th>
            <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Against its 20, 50, 200-day averages</th>
            <th scope="col" className="py-1.5 text-right font-normal">Trend</th>
          </tr>
        </thead>
        <tbody>
          {prices.pairs.map((p) => (
            <tr key={p.symbol} className="border-b border-line">
              <td className="py-1.5 pr-3">
                <span className="font-medium">{p.symbol}</span>
                {p.brokerSymbol !== p.symbol && <span className="ml-1.5 text-[12px] text-muted">{p.brokerSymbol}</span>}
              </td>
              {p.seasonality ? (
                <>
                  <td className="num whitespace-nowrap py-1.5 pr-3 text-right">{p.seasonality.upYears} of {p.seasonality.years}</td>
                  <td className={cx("num whitespace-nowrap py-1.5 pr-3 text-right", p.seasonality.avgPct > 0 ? "text-profit" : p.seasonality.avgPct < 0 ? "text-loss" : undefined)}>{p.seasonality.avgPct > 0 ? "+" : p.seasonality.avgPct < 0 ? "−" : ""}{Math.abs(p.seasonality.avgPct).toFixed(2)}%</td>
                </>
              ) : (
                <td colSpan={2} className="py-1.5 pr-3 text-right text-[12.5px] text-muted">under 5 years of prices</td>
              )}
              <td className="hidden py-1.5 pr-3 text-ink-soft sm:table-cell">{(["20", "50", "200"] as const).map((n) => side(p.trend.above[n])).join(", ")}</td>
              <td className={cx("num py-1.5 text-right", p.trend.score === null ? "text-muted" : p.trend.score > 0 ? "text-profit" : p.trend.score < 0 ? "text-loss" : undefined)}>{p.trend.score === null ? "none" : signed(p.trend.score, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
