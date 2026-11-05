"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import type { CalendarEvent, Instrument, InstrumentContext } from "@/lib/server/market/types";
import { Sparkline } from "@/components/charts";
import { Badge, Button, Card, CardHeader, DemoBanner, EmptyState, PageHeader, Spinner, cx } from "@/components/ui";

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
  if (!data) return <Spinner />;

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
          <strong>{data.source.label}.</strong> {data.source.disclosure} Connecting a licensed data provider is a configuration step documented in the README.
        </DemoBanner>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {ordered.map((c) => {
            const s = c.instrument.symbol;
            const isOpen = open === s;
            const isFollowed = followed.includes(s);
            return (
              <Card key={s} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-40 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{s}</h2>
                      {isFollowed && <Badge tone="accent">Following</Badge>}
                    </div>
                    <p className="truncate text-[12.5px] text-muted">{c.instrument.name}</p>
                  </div>
                  <Sparkline values={c.bars.map((b) => b.c)} up={c.changePct >= 0} />
                  <div className="num w-28 text-right">
                    <div className="text-[14px]">{fmtPrice(c.last)}</div>
                    <div className={cx("text-[12px]", c.changePct >= 0 ? "text-profit" : "text-loss")}>{c.changePct >= 0 ? "+" : ""}{c.changePct.toFixed(2)}%</div>
                  </div>
                  <div className="w-28 text-right">
                    <Badge tone={c.bias === "bullish" ? "profit" : c.bias === "bearish" ? "loss" : "neutral"}>{c.bias}</Badge>
                    <div className="mt-1 text-[11.5px] text-muted" title="How strongly the factors agree. Not a probability.">agreement {c.agreement}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : s)} aria-expanded={isOpen}>{isOpen ? "Hide factors" : "Why this bias?"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleFollow(s)}>{isFollowed ? "Unfollow" : "Follow"}</Button>
                </div>
                {isOpen && (
                  <ul className="mt-3 space-y-2 border-t border-line pt-3">
                    {c.factors.map((f) => (
                      <li key={f.name} className="grid grid-cols-[1fr_auto] gap-x-3 text-[13px]">
                        <span className="font-medium">{f.name}</span>
                        <span className={cx("num", f.score > 0.1 ? "text-profit" : f.score < -0.1 ? "text-loss" : "text-muted")}>{f.score >= 0 ? "+" : ""}{f.score.toFixed(2)}</span>
                        <span className="col-span-2 text-muted">{f.explanation}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>

        <Card className="self-start">
          <CardHeader title="Economic calendar" subtitle={kind === "live" ? "Upcoming releases" : "Simulated entries"} />
          <div className="divide-y divide-line">
            {[...byDay.entries()].map(([d, events]) => (
              <div key={d} className="px-4 py-3">
                <h3 className="text-[13px] font-semibold text-muted">{new Date(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</h3>
                <ul className="mt-2 space-y-2">
                  {events.map((e) => (
                    <li key={e.id} className="text-[13px]">
                      <div className="flex items-center gap-2">
                        <span className="num text-muted">{new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                        <Badge>{e.region}</Badge>
                        <span className={cx("h-2 w-2 rounded-full", e.impact === "high" ? "bg-loss" : e.impact === "medium" ? "bg-accent" : "bg-muted")} aria-label={`${e.impact} impact`} role="img" />
                        <span className="min-w-0 truncate">{e.title}</span>
                      </div>
                      <div className="num mt-0.5 pl-12 text-[12px] text-muted">
                        prev {e.previous ?? "—"} · fcst {e.forecast ?? "—"} · actual {e.actual ?? "pending"}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
