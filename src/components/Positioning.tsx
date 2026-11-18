"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { Positioning as Data } from "@/lib/server/market/cot";
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
                <li key={p.symbol} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-[13.5px]">
                  <span className="font-medium">{p.symbol}</span>
                  <ScoreBar score={p.score} />
                  <span className="text-right text-ink-soft"><span className="capitalize">{p.bias}</span> <span className="num">{signed(p.score, 2)}</span></span>
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
                    </td>
                    <td className="num py-1.5 pr-3 text-right">{signed(a.netPct, 1)}%</td>
                    <td className={cx("num hidden py-1.5 pr-3 text-right sm:table-cell", a.weeklyChange > 0 ? "text-profit" : a.weeklyChange < 0 ? "text-loss" : "text-muted")}>{signed(a.weeklyChange)}</td>
                    <td className="num py-1.5 pr-3 text-right">
                      {a.cotIndex}
                      {a.crowded && <span className="ml-1.5 text-[12px] text-warn">crowded</span>}
                    </td>
                    <td className="hidden py-1.5 md:table-cell"><Sparkline values={a.history} up={a.weeklyChange >= 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
      {data && (
        <p className="mt-4 text-[12.5px] text-muted">
          Non-commercial (large speculator) futures positions. A pair scores its base against its quote: positive means speculators favour the base. Crowded means the top or bottom tenth of the 3-year range, where positioning has the least room left. Context for your review, not a signal to trade.
        </p>
      )}
    </Card>
  );
}
