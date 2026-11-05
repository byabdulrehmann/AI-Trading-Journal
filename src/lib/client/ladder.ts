/** Decimals as typed, so "1.0810" keeps four. Blank or unreadable text gives null. */
export function decimalsOf(text: string): number | null {
  const t = text.trim();
  if (t === "" || !Number.isFinite(Number(t))) return null;
  const dot = t.indexOf(".");
  return dot === -1 ? 0 : t.length - dot - 1;
}

export const priceText = (price: number, decimals: number) => price.toFixed(decimals);

export const tickOf = (decimals: number) => 1 / 10 ** decimals;

/** About `count` round prices inside the range, for the scale's hairlines. */
export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0) || count < 1) return [];
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  // Rounded on the step's own decimals: repeated addition drifts on values like 0.0005.
  const dp = Math.max(0, -Math.floor(Math.log10(step)));
  for (let i = Math.ceil(min / step); i * step <= max; i++) out.push(Number((i * step).toFixed(dp)));
  return out;
}

/** Labels for lines at the given heights, pushed apart just enough not to overlap and kept inside [lo, hi]. Output order matches input. */
export function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => o.y);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(k ? placed[k - 1] + gap : lo, placed[k]);
  placed[placed.length - 1] = Math.min(placed[placed.length - 1] ?? hi, hi);
  for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k], placed[k + 1] - gap);
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = placed[k]));
  return out;
}
