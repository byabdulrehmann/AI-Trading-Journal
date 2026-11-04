import "server-only";
import type { Bar, CalendarEvent, Factor, Instrument, InstrumentContext, MarketDataProvider } from "./types";

/**
 * Demo provider: deterministic pseudo-random series seeded by symbol and
 * calendar day. It is NOT market data and says so in `dataKind`/`disclosure`.
 */
const INSTRUMENTS: (Instrument & { base: number; vol: number })[] = [
  { symbol: "EURUSD", name: "Euro / US dollar", assetClass: "fx", base: 1.08, vol: 0.004 },
  { symbol: "GBPUSD", name: "British pound / US dollar", assetClass: "fx", base: 1.27, vol: 0.005 },
  { symbol: "USDJPY", name: "US dollar / Japanese yen", assetClass: "fx", base: 150, vol: 0.005 },
  { symbol: "XAUUSD", name: "Gold / US dollar", assetClass: "commodity", base: 2650, vol: 0.009 },
  { symbol: "WTI", name: "WTI crude oil", assetClass: "commodity", base: 72, vol: 0.018 },
  { symbol: "US100", name: "US tech 100 index", assetClass: "index", base: 20500, vol: 0.011 },
  { symbol: "US500", name: "US 500 index", assetClass: "index", base: 5900, vol: 0.008 },
  { symbol: "BTCUSD", name: "Bitcoin / US dollar", assetClass: "crypto", base: 68000, vol: 0.03 },
];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function series(symbol: string, base: number, vol: number): Bar[] {
  const rand = rng(hash(symbol + today()));
  const bars: Bar[] = [];
  let price = base;
  const drift = (rand() - 0.5) * vol * 0.4;
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    price *= 1 + drift + (rand() - 0.5) * 2 * vol;
    bars.push({ t: d.toISOString().slice(0, 10), c: price });
  }
  return bars;
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const sma = (xs: number[], n: number) => xs.slice(-n).reduce((a, b) => a + b, 0) / Math.min(n, xs.length);

function factors(bars: Bar[], symbol: string): Factor[] {
  const closes = bars.map((b) => b.c);
  const last = closes.at(-1) as number;
  const trend = clamp(((sma(closes, 10) - sma(closes, 40)) / sma(closes, 40)) * 40);
  const momentum = clamp(((last - closes[closes.length - 15]) / closes[closes.length - 15]) * 25);
  const rand = rng(hash(symbol + "sentiment" + today()));
  const sentiment = clamp((rand() - 0.5) * 1.6);
  return [
    {
      name: "Trend (simulated)",
      score: trend,
      explanation: `10-day average is ${trend >= 0 ? "above" : "below"} the 40-day average of the simulated series.`,
    },
    {
      name: "Momentum (simulated)",
      score: momentum,
      explanation: `Simulated price is ${momentum >= 0 ? "up" : "down"} over the last 15 sessions.`,
    },
    {
      name: "Sentiment (placeholder)",
      score: sentiment,
      explanation: "Random placeholder. A real provider would score news or positioning here.",
    },
  ];
}

export const demoMarketProvider: MarketDataProvider = {
  id: "demo",
  label: "Demo market data",
  dataKind: "simulated",
  disclosure:
    "Simulated series generated on this computer. Prices, bias and calendar entries are not real market data and must not be used for trading decisions.",

  async listInstruments() {
    return INSTRUMENTS.map(({ symbol, name, assetClass }) => ({ symbol, name, assetClass }));
  },

  async getContext(symbol): Promise<InstrumentContext | null> {
    const ins = INSTRUMENTS.find((i) => i.symbol === symbol);
    if (!ins) return null;
    const bars = series(ins.symbol, ins.base, ins.vol);
    const fs = factors(bars, ins.symbol);
    const avg = fs.reduce((a, f) => a + f.score, 0) / fs.length;
    const sameSign = fs.filter((f) => Math.sign(f.score) === Math.sign(avg)).length;
    const last = bars.at(-1)!.c;
    const prev = bars.at(-2)!.c;
    return {
      instrument: { symbol: ins.symbol, name: ins.name, assetClass: ins.assetClass },
      last,
      changePct: ((last - prev) / prev) * 100,
      bars,
      bias: avg > 0.15 ? "bullish" : avg < -0.15 ? "bearish" : "neutral",
      agreement: Math.round((sameSign / fs.length) * Math.min(1, Math.abs(avg) * 2) * 100),
      factors: fs,
      asOf: new Date().toISOString(),
    };
  },

  async getCalendar(fromIso, toIso) {
    const events: CalendarEvent[] = [];
    const templates = [
      { region: "US", title: "Consumer prices (demo)", impact: "high" as const },
      { region: "US", title: "Jobs report (demo)", impact: "high" as const },
      { region: "EU", title: "Rate decision (demo)", impact: "high" as const },
      { region: "UK", title: "Retail sales (demo)", impact: "medium" as const },
      { region: "US", title: "Manufacturing survey (demo)", impact: "medium" as const },
      { region: "JP", title: "Trade balance (demo)", impact: "low" as const },
    ];
    const from = new Date(fromIso);
    const to = new Date(toIso);
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const key = d.toISOString().slice(0, 10);
      const rand = rng(hash("cal" + key));
      const n = Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const tpl = templates[Math.floor(rand() * templates.length)];
        const at = new Date(d);
        at.setUTCHours(8 + Math.floor(rand() * 8), rand() < 0.5 ? 0 : 30, 0, 0);
        const prevVal = (rand() * 4).toFixed(1);
        const fc = (Number(prevVal) + (rand() - 0.5)).toFixed(1);
        const past = at.getTime() < Date.now();
        events.push({
          id: `${key}-${i}`,
          at: at.toISOString(),
          region: tpl.region,
          title: tpl.title,
          impact: tpl.impact,
          forecast: `${fc}%`,
          previous: `${prevVal}%`,
          actual: past ? `${(Number(fc) + (rand() - 0.5) * 0.6).toFixed(1)}%` : null,
        });
      }
    }
    return events.sort((a, b) => a.at.localeCompare(b.at));
  },
};

export function marketProvider(): MarketDataProvider {
  // Swap in a licensed provider here once credentials and terms are in place.
  return demoMarketProvider;
}
