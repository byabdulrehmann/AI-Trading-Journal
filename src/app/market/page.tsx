"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import type { CalendarEvent, Instrument, InstrumentContext } from "@/lib/server/market/types";
import { Sparkline } from "@/components/charts";
import { Button, Card, CardHeader, DemoBanner, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";

interface MarketResponse {
  source: { id: string; label: string; dataKind: "simulated" | "delayed" | "live"; disclosure: string };
  instruments: Instrument[];
  contexts: InstrumentContext[];
  calendar: CalendarEvent[];
}

const fmtPrice = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 5 : 2, minimumFractionDigits: n < 10 ? 4 : 2 });

export default function MarketPage() {
  const { settings, saveSettings } = useApp();
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<MarketResponse>("/api/market").then(setData).catch((e) => setError(e.message));
  }, []);

  const followed = settings?.followedInstruments ?? [];
  const toggleFollow = (s: string) =>
    void saveSettings({ followedInstruments: followed.includes(s) ? followed.filter((x) => x !== s) : [...followed, s] });

  if (error) return <EmptyState title="Couldn't load market context" body={error} />;
  if (!data) return <Spinner label="Loading market context" />;

  const kind = data.source.dataKind;
  const ordered = [...data.contexts].sort((a, b) => Number(followed.includes(b.instrument.symbol)) - Number(followed.includes(a.instrument.symbol)));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of data.calendar) {
    const k = new Date(e.at).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  return (
    <>
      <PageHeader title="Market context" description="A bias for each instrument you follow, with the factors behind it, and the economic calendar." />
      {kind !== "live" && (
        <DemoBanner>
          <span className="font-medium">{data.source.label}.</span> {data.source.disclosure} Connecting a licensed data provider is a configuration step documented in the README.
        </DemoBanner>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <Card>
          <table className="w-full text-[14px]">
            <caption className="sr-only">Instruments with their last price, change and bias</caption>
            <thead className="text-left text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-1.5 pr-3 font-normal">Instrument</th>
                <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell"><span className="sr-only">Recent closes</span></th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">Last</th>
                <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">Bias</th>
                <th scope="col" className="hidden py-1.5 text-right font-normal sm:table-cell" title="How strongly the factors agree. Not a probability.">Agreement</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((c) => {
                const s = c.instrument.symbol;
                const isOpen = open === s;
                const isFollowed = followed.includes(s);
                return (
                  <Fragment key={s}>
                    <tr className={cx("align-top", !isOpen && "border-b border-line")}>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <h2 className="font-medium">{s}</h2>
                          {isFollowed && <span className="text-[12.5px] text-ink-soft">Following</span>}
                        </div>
                        <p className="truncate text-[12.5px] text-muted">{c.instrument.name}</p>
                        <p className="text-[12.5px] text-ink-soft sm:hidden">{c.bias[0].toUpperCase() + c.bias.slice(1)}, agreement <span className="num">{c.agreement}</span></p>
                        <div className="mt-1 -ml-3 flex flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : s)} aria-expanded={isOpen}>{isOpen ? "Hide factors" : "Why this bias?"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleFollow(s)}>{isFollowed ? "Unfollow" : "Follow"}</Button>
                        </div>
                      </td>
                      <td className="hidden py-2 pr-3 sm:table-cell"><Sparkline values={c.bars.map((b) => b.c)} up={c.changePct >= 0} /></td>
                      <td className="num py-2 pr-3 text-right">
                        <div>{fmtPrice(c.last)}</div>
                        <div className={cx("text-[12.5px]", c.changePct >= 0 ? "text-profit" : "text-loss")}>{c.changePct >= 0 ? "+" : ""}{c.changePct.toFixed(2)}%</div>
                      </td>
                      <td className="hidden py-2 pr-3 capitalize sm:table-cell">{c.bias}</td>
                      <td className="num hidden py-2 text-right sm:table-cell">{c.agreement}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line">
                        <td colSpan={5} className="pb-3">
                          <ul className="divide-y divide-line border-t border-line">
                            {c.factors.map((f) => (
                              <li key={f.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5 text-[13px]">
                                <span className="font-medium">{f.name}</span>
                                <span className="num text-ink-soft">{f.score >= 0 ? "+" : ""}{f.score.toFixed(2)}</span>
                                <span className="col-span-2 text-muted">{f.explanation}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="self-start">
          <CardHeader title="Economic calendar" subtitle={kind === "live" ? "Upcoming releases, local time" : "Simulated entries, local time"} />
          {[...byDay.entries()].map(([d, events]) => (
            <section key={d} className="border-t border-line py-2">
              <h3 className="text-[13px] font-medium text-muted">{new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</h3>
              <ul>
                {events.map((e) => (
                  <li key={e.id} className="py-1.5 text-[13px]">
                    <div className="flex items-baseline gap-2">
                      <span className="num text-muted">{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="min-w-0 flex-1">{e.title}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {e.region}, <span className={e.impact === "high" ? "text-ink" : undefined}>{e.impact} impact</span>
                    </p>
                    <dl className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px]">
                      <div className="flex gap-1"><dt className="text-muted">Previous</dt><dd className="num">{e.previous ?? "not given"}</dd></div>
                      <div className="flex gap-1"><dt className="text-muted">Forecast</dt><dd className="num">{e.forecast ?? "not given"}</dd></div>
                      <div className="flex gap-1"><dt className="text-muted">Actual</dt><dd className="num">{e.actual ?? "pending"}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      </div>
    </>
  );
}
