import type { Trade } from "./types";
import { holdMinutes, isClosed, localDateKey, median } from "./metrics";
import { plannedRisk, round } from "./trade-math";

/**
 * Behavioural pattern detectors.
 *
 * Each detector works only from fields the user recorded, needs a minimum
 * sample before it reports anything, and returns the exact trades it used as
 * evidence. Wording is deliberately tentative: these are patterns in records,
 * not judgements about the trader's state of mind.
 */
export interface PatternFinding {
  id: string;
  title: string;
  /** Plain statement of what the records show (fact). */
  observation: string;
  /** Tentative reading of the fact (inference). Users can dismiss it. */
  interpretation: string;
  /** Something the trader could try (suggestion). */
  suggestion: string;
  /** How the detector decides, so the user can check it. */
  rule: string;
  occurrences: number;
  /** Net P&L of the evidence trades; negative is a cost. Null when not meaningful. */
  cost: number | null;
  evidenceTradeIds: number[];
  confidence: "low" | "medium";
}

export const PATTERN_RULES: Record<string, { title: string; rule: string; minSample: string }> = {
  "holding-losers": {
    title: "Losers held longer than winners",
    rule: "Median hold time of losing trades is at least 1.5× that of winning trades.",
    minSample: "3 winners and 3 losers",
  },
  "quick-reentry": {
    title: "Fast re-entry after a loss",
    rule: "A new trade on the same account opens within 15 minutes of a losing trade closing.",
    minSample: "2 occurrences",
  },
  "size-up-after-loss": {
    title: "Larger risk after a loss",
    rule: "Planned risk (or size, without a stop) is at least 1.5× the previous trade, right after a losing trade.",
    minSample: "2 occurrences",
  },
  "early-exit": {
    title: "Winners closed well before target",
    rule: "A winning trade with a target is closed at less than half of its planned reward:risk.",
    minSample: "3 occurrences",
  },
  "loss-beyond-stop": {
    title: "Losses larger than planned",
    rule: "A losing trade with a stop finishes below −1.2R.",
    minSample: "2 occurrences",
  },
  "plan-deviation": {
    title: "Off-plan trades cost more",
    rule: "Average P&L of trades you marked ‘did not follow plan’ is below that of trades you marked ‘followed plan’.",
    minSample: "3 off-plan and 3 on-plan trades",
  },
  "busy-days": {
    title: "Results on unusually busy days",
    rule: "Days with more than twice your median number of trades, compared with other days.",
    minSample: "5 trading days",
  },
};

export function detectPatterns(trades: Trade[]): PatternFinding[] {
  const closed = trades.filter(isClosed).sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const found: (PatternFinding | null)[] = [
    holdingLosers(closed),
    quickReentry(closed),
    sizeUpAfterLoss(closed),
    earlyExit(closed),
    lossBeyondStop(closed),
    planDeviation(closed),
    busyDays(closed),
  ];
  return found.filter((f): f is PatternFinding => f !== null);
}

type Closed = Trade & { pnl: number; closedAt: string };

function base(id: string) {
  return { id, title: PATTERN_RULES[id].title, rule: PATTERN_RULES[id].rule };
}

const totalPnl = (ts: Closed[]) => round(ts.reduce((a, t) => a + t.pnl, 0));
const fmtMin = (m: number) => (m >= 120 ? `${round(m / 60, 1)} h` : `${Math.round(m)} min`);

function holdingLosers(closed: Closed[]): PatternFinding | null {
  const winners = closed.filter((t) => t.pnl > 0);
  const losers = closed.filter((t) => t.pnl < 0);
  if (winners.length < 3 || losers.length < 3) return null;
  const mw = median(winners.map((t) => holdMinutes(t) as number)) as number;
  const ml = median(losers.map((t) => holdMinutes(t) as number)) as number;
  if (mw <= 0 || ml < mw * 1.5) return null;
  const evidence = losers.filter((t) => (holdMinutes(t) as number) > mw);
  return {
    ...base("holding-losers"),
    observation: `Your losing trades stayed open for a median of ${fmtMin(ml)}, against ${fmtMin(mw)} for winners.`,
    interpretation: "This may mean losing positions are given more room than the plan allowed. It can also reflect your strategy — only you can tell.",
    suggestion: "Before entering, write down the point where the idea is wrong, and compare it with where you actually exited.",
    occurrences: evidence.length,
    cost: totalPnl(evidence),
    evidenceTradeIds: evidence.map((t) => t.id),
    confidence: losers.length >= 8 ? "medium" : "low",
  };
}

function quickReentry(closed: Closed[]): PatternFinding | null {
  const hits = new Set<Closed>();
  const opened = closed.map((t) => Date.parse(t.openedAt)); // closed is sorted by open time
  for (const loss of closed.filter((t) => t.pnl < 0)) {
    const lossEnd = Date.parse(loss.closedAt);
    let [lo, hi] = [0, opened.length];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (opened[mid] < lossEnd) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < opened.length && opened[i] - lossEnd <= 15 * 60000; i++) {
      if (closed[i].id !== loss.id && closed[i].accountId === loss.accountId) {
        hits.add(closed[i]);
        break;
      }
    }
  }
  if (hits.size < 2) return null;
  const list = [...hits];
  const wins = list.filter((t) => t.pnl > 0).length;
  return {
    ...base("quick-reentry"),
    observation: `${list.length} trades opened within 15 minutes of a losing trade. Together they made ${fmt(totalPnl(list))} (${wins} of ${list.length} won).`,
    interpretation: "Quick re-entries after a loss are sometimes driven by wanting to win the money back rather than by the setup. That may or may not apply to you.",
    suggestion: "Consider a short pause rule after a loss, and check whether the next setup would have qualified on a fresh day.",
    occurrences: list.length,
    cost: totalPnl(list),
    evidenceTradeIds: list.map((t) => t.id),
    confidence: list.length >= 5 ? "medium" : "low",
  };
}

function exposure(t: Trade): number {
  return plannedRisk(t) ?? t.quantity * t.multiplier * t.entryPrice;
}

function sizeUpAfterLoss(closed: Closed[]): PatternFinding | null {
  const hits: Closed[] = [];
  for (let i = 1; i < closed.length; i++) {
    const prev = closed[i - 1];
    const cur = closed[i];
    if (prev.pnl >= 0 || prev.accountId !== cur.accountId) continue;
    if (exposure(cur) >= exposure(prev) * 1.5) hits.push(cur);
  }
  if (hits.length < 2) return null;
  return {
    ...base("size-up-after-loss"),
    observation: `${hits.length} times, the trade right after a loss carried at least 1.5× the risk of the losing trade. Those trades made ${fmt(totalPnl(hits))}.`,
    interpretation: "Raising risk after a loss can be a deliberate plan, or a way of trying to recover faster. Your records can't tell which.",
    suggestion: "If it isn't part of your plan, try fixing risk per trade for the rest of the session after a loss.",
    occurrences: hits.length,
    cost: totalPnl(hits),
    evidenceTradeIds: hits.map((t) => t.id),
    confidence: hits.length >= 5 ? "medium" : "low",
  };
}

function earlyExit(closed: Closed[]): PatternFinding | null {
  const hits = closed.filter(
    (t) => t.pnl > 0 && t.plannedR !== null && t.rMultiple !== null && t.rMultiple < t.plannedR * 0.5,
  );
  if (hits.length < 3) return null;
  const left = round(
    hits.reduce((a, t) => a + ((t.plannedR as number) - (t.rMultiple as number)) * (plannedRisk(t) as number), 0),
  );
  return {
    ...base("early-exit"),
    observation: `${hits.length} winning trades closed at less than half of their planned reward:risk. Reaching the planned targets would have added roughly ${fmt(left)} — if price had got there, which these records can't confirm.`,
    interpretation: "This might reflect taking profit early to lock in a win. It can also be good trade management when conditions changed.",
    suggestion: "Note why you exited each time. Over a few weeks that tells you whether early exits help or hurt.",
    occurrences: hits.length,
    cost: null,
    evidenceTradeIds: hits.map((t) => t.id),
    confidence: hits.length >= 6 ? "medium" : "low",
  };
}

function lossBeyondStop(closed: Closed[]): PatternFinding | null {
  const hits = closed.filter((t) => t.pnl < 0 && t.rMultiple !== null && t.rMultiple < -1.2);
  if (hits.length < 2) return null;
  const extra = round(hits.reduce((a, t) => a + (t.pnl + (plannedRisk(t) as number)), 0));
  return {
    ...base("loss-beyond-stop"),
    observation: `${hits.length} losing trades finished beyond −1.2R. The part beyond the planned −1R totals ${fmt(extra)}.`,
    interpretation: "This can come from slippage, gaps or fees — or from moving or ignoring a stop. Check each trade before drawing a conclusion.",
    suggestion: "Record whether the stop was moved. If slippage is the cause, consider it in position sizing.",
    occurrences: hits.length,
    cost: extra,
    evidenceTradeIds: hits.map((t) => t.id),
    confidence: hits.length >= 4 ? "medium" : "low",
  };
}

function planDeviation(closed: Closed[]): PatternFinding | null {
  const off = closed.filter((t) => t.followedPlan === false);
  const on = closed.filter((t) => t.followedPlan === true);
  if (off.length < 3 || on.length < 3) return null;
  const avgOff = totalPnl(off) / off.length;
  const avgOn = totalPnl(on) / on.length;
  if (avgOff >= avgOn) return null;
  return {
    ...base("plan-deviation"),
    observation: `Trades you marked off-plan averaged ${fmt(round(avgOff))} each (${off.length} trades), compared with ${fmt(round(avgOn))} for on-plan trades (${on.length}).`,
    interpretation: "In your own records, sticking to the plan has gone with better results so far. The sample is small, so treat it as a hint.",
    suggestion: "When a trade is off-plan, write one line on what pulled you away from the plan.",
    occurrences: off.length,
    cost: round((avgOff - avgOn) * off.length),
    evidenceTradeIds: off.map((t) => t.id),
    confidence: off.length >= 8 ? "medium" : "low",
  };
}

function busyDays(closed: Closed[]): PatternFinding | null {
  const days = new Map<string, Closed[]>();
  for (const t of closed) {
    const k = localDateKey(t.openedAt);
    days.set(k, [...(days.get(k) ?? []), t]);
  }
  if (days.size < 5) return null;
  const counts = [...days.values()].map((d) => d.length);
  const med = median(counts) as number;
  const busy = [...days.values()].filter((d) => d.length > med * 2);
  if (busy.length === 0) return null;
  const busyTrades = busy.flat();
  const busyAvg = totalPnl(busyTrades) / busy.length;
  const others = [...days.values()].filter((d) => d.length <= med * 2);
  const otherAvg = others.length ? totalPnl(others.flat()) / others.length : 0;
  if (busyAvg >= otherAvg) return null;
  return {
    ...base("busy-days"),
    observation: `On ${busy.length} day(s) with more than ${med * 2} trades, you averaged ${fmt(round(busyAvg))} per day, against ${fmt(round(otherAvg))} on other days.`,
    interpretation: "Busy days going worse can point to forcing trades, but busy days may also simply be volatile markets.",
    suggestion: "Try setting a daily trade limit and see whether results on capped days differ.",
    occurrences: busyTrades.length,
    cost: round(totalPnl(busyTrades) - otherAvg * busy.length),
    evidenceTradeIds: busyTrades.map((t) => t.id),
    confidence: "low",
  };
}

function fmt(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
