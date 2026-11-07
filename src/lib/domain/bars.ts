/** One candle. Time is epoch seconds, UTC. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export const TIMEFRAME_SECONDS = { M1: 60, M5: 300, M15: 900, H1: 3600 } as const;
export type Timeframe = keyof typeof TIMEFRAME_SECONDS;

/** Where bars came from. The page always says, so simulated prices can't pass as real ones. */
export type BarSource = "mt5" | "simulated";

export interface BarMarker {
  t: number;
  role: "entry" | "exit";
  side: "long" | "short";
  price: number;
  quantity: number;
  tradeId: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Made-up candles for sample trades only: a noisy walk that passes through every fill at its time. Repeatable from the
 * seed, so a sample trade looks the same each time, and always labelled as simulated where it's shown.
 */
export function simulatedBars(anchors: { t: number; price: number }[], from: number, to: number, step: number, seed: number): Bar[] {
  const points = [...anchors].sort((a, b) => a.t - b.t);
  if (points.length === 0) return [];
  const rand = rng(seed);
  const first = points[0];
  const last = points[points.length - 1];
  const typical = first.price * 0.0006;
  const priceAt = (t: number) => {
    if (t <= first.t) return first.price;
    if (t >= last.t) return last.price;
    const next = points.findIndex((p) => p.t >= t);
    const [a, b] = [points[next - 1], points[next]];
    return a.price + ((t - a.t) / (b.t - a.t || 1)) * (b.price - a.price);
  };
  const bars: Bar[] = [];
  let prev = priceAt(from) + (rand() - 0.5) * typical;
  for (let t = Math.floor(from / step) * step; t <= to; t += step) {
    const inBar = points.filter((p) => p.t >= t && p.t < t + step).map((p) => p.price);
    const close = priceAt(t + step) + (t + step < first.t || t > last.t ? (rand() - 0.5) * typical * 3 : (rand() - 0.5) * typical);
    const open = prev;
    const high = Math.max(open, close, ...inBar) + rand() * typical * 0.5;
    const low = Math.max(first.price * 0.01, Math.min(open, close, ...inBar) - rand() * typical * 0.5);
    const dp = (x: number) => Math.round(x * 1e5) / 1e5;
    bars.push({ t, o: dp(open), h: dp(high), l: dp(low), c: dp(close) });
    prev = close;
  }
  return bars;
}
