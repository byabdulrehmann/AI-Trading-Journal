/**
 * Economic surprises: how each currency's releases came in against forecast, from the calendar events the user
 * imported or entered. Beats count for the currency and misses against it, weighted by impact. Where higher is
 * worse (unemployment, jobless claims), the direction flips. Higher inflation counts as a beat: it points to
 * higher rates.
 */

export const SURPRISE_DAYS = 30;
const WEIGHT = { high: 3, medium: 2, low: 1 } as const;
const INVERSE = /unemploy|jobless|claim/i;

export interface SurpriseEvent {
  at: string;
  currency: string;
  title: string;
  impact: string;
  actual: string;
  forecast: string;
}

export interface CurrencySurprise {
  key: string;
  /** −1…+1: every weighted release beat (+1) or missed (−1). Null with no scored releases. */
  score: number | null;
  beats: number;
  misses: number;
  inline: number;
  /** The scored releases, newest first. */
  releases: { at: string; title: string; impact: string; actual: string; forecast: string; result: "beat" | "miss" | "inline" }[];
}

const MULTIPLIER: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** The start of the window: the one definition the query and the scoring share. */
export const surpriseSince = (now: number) => now - SURPRISE_DAYS * 86_400_000;

/** "2.5%", "-0.1%", "215K", "1,234.5", "−3.2B", "$-3.2B", "-¥1.1T", "<0.1%" → a number; anything else → null. */
export function parseFigure(raw: string): number | null {
  const plain = raw.replace(/[,\s$€£¥₹]/g, "").replace(/−/g, "-").replace(/^[<>~≈]/, "");
  const m = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)([KMBT%])?$/i.exec(plain);
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * Number(m[2]) * (MULTIPLIER[(m[3] ?? "").toUpperCase()] ?? 1);
}

export function scoreSurprises(events: SurpriseEvent[], currencies: string[], now = Date.now()): CurrencySurprise[] {
  const since = surpriseSince(now);
  return currencies.map((key) => {
    const releases: CurrencySurprise["releases"] = [];
    let weighted = 0;
    let total = 0;
    for (const e of events) {
      const t = Date.parse(e.at);
      if (e.currency !== key || t > now || t < since || !(e.impact in WEIGHT)) continue;
      const [actual, forecast] = [parseFigure(e.actual), parseFigure(e.forecast)];
      if (actual === null || forecast === null) continue;
      const dir = Math.sign(actual - forecast) * (INVERSE.test(e.title) ? -1 : 1);
      const w = WEIGHT[e.impact as keyof typeof WEIGHT];
      weighted += w * dir;
      total += w;
      releases.push({ at: e.at, title: e.title, impact: e.impact, actual: e.actual, forecast: e.forecast, result: dir > 0 ? "beat" : dir < 0 ? "miss" : "inline" });
    }
    releases.sort((a, b) => b.at.localeCompare(a.at));
    const count = (r: string) => releases.filter((x) => x.result === r).length;
    return { key, score: total ? Math.round((weighted / total) * 100) / 100 : null, beats: count("beat"), misses: count("miss"), inline: count("inline"), releases };
  });
}
