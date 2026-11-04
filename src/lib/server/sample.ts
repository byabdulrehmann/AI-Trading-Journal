import "server-only";
import { db, transaction } from "./db";
import { createAccount, createTrade, hasSampleData } from "./repo/journal";
import type { TradeData } from "@/lib/domain/types";
import { EMOTIONS } from "@/lib/domain/types";

/**
 * Sample journal for exploring the app. Every row is stored with
 * source = 'sample' and shown with a "Sample" badge; it never mixes silently
 * with the user's own records and can be removed in Settings.
 */
const INSTRUMENTS = [
  { symbol: "EURUSD", price: 1.085, tick: 0.0004, qty: 100000, mult: 1 },
  { symbol: "XAUUSD", price: 2650, tick: 3.5, qty: 10, mult: 1 },
  { symbol: "US100", price: 20500, tick: 25, qty: 2, mult: 1 },
  { symbol: "GBPUSD", price: 1.27, tick: 0.0005, qty: 100000, mult: 1 },
];
const SETUPS = ["Breakout", "Pullback", "Range fade", "News drift"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function loadSampleData(): number {
  if (hasSampleData()) return 0;
  const rand = rng(20261103);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  return transaction(db(), () => {
    const account = createAccount({ name: "Sample account", broker: "Sample data", currency: "USD", startingBalance: 25000 }, true);
    const start = new Date();
    start.setDate(start.getDate() - 42);
    let count = 0;
    let lastLoss: { closedAt: number } | null = null;

    for (let day = 0; day < 42; day++) {
      const d = new Date(start);
      d.setDate(start.getDate() + day);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const perDay = rand() < 0.15 ? 5 : 1 + Math.floor(rand() * 2);
      let clock = new Date(d);
      clock.setHours(8 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);

      for (let n = 0; n < perDay; n++) {
        const ins = pick(INSTRUMENTS);
        const side = rand() < 0.55 ? "long" : "short";
        const dir = side === "long" ? 1 : -1;
        const riskTicks = 4 + Math.floor(rand() * 4);
        const entry = ins.price * (1 + (rand() - 0.5) * 0.02);
        const stop = entry - dir * riskTicks * ins.tick;
        const target = entry + dir * riskTicks * ins.tick * 2;

        // Re-entry right after a loss with bigger size: plants the patterns the detectors look for.
        const revenge = lastLoss !== null && rand() < 0.5;
        if (revenge && lastLoss) clock = new Date(lastLoss.closedAt + (3 + rand() * 9) * 60000);
        const qtyScale = revenge ? 2 : 1;

        const roll = rand();
        let rOutcome: number;
        let holdMin: number;
        if (revenge) {
          rOutcome = roll < 0.35 ? 1 + rand() : -1 - rand() * 0.5;
          holdMin = 10 + rand() * 40;
        } else if (roll < 0.48) {
          rOutcome = rand() < 0.45 ? 0.4 + rand() * 0.4 : 1.5 + rand() * 0.6; // some early exits
          holdMin = 15 + rand() * 60;
        } else {
          rOutcome = rand() < 0.25 ? -1.3 - rand() * 0.5 : -1;
          holdMin = 60 + rand() * 180; // losers held longer
        }
        const exit = entry + dir * rOutcome * riskTicks * ins.tick;
        const openedAt = new Date(clock);
        const closedAt = new Date(clock.getTime() + holdMin * 60000);
        const followedPlan = revenge ? false : rOutcome < -1.2 ? false : rand() < 0.85;

        const trade: TradeData = {
          accountId: account.id,
          symbol: ins.symbol,
          side,
          openedAt: openedAt.toISOString(),
          closedAt: closedAt.toISOString(),
          entryPrice: round(entry, ins.tick < 0.01 ? 5 : 2),
          exitPrice: round(exit, ins.tick < 0.01 ? 5 : 2),
          quantity: ins.qty * qtyScale,
          multiplier: ins.mult,
          stopPrice: round(stop, ins.tick < 0.01 ? 5 : 2),
          targetPrice: round(target, ins.tick < 0.01 ? 5 : 2),
          fees: round(2 + rand() * 6, 2),
          setup: revenge ? "" : pick(SETUPS),
          tags: revenge ? ["unplanned"] : [],
          emotionBefore: revenge ? pick(["frustrated", "impatient"] as const) : pick(EMOTIONS.slice(0, 4)),
          emotionAfter: rOutcome > 0 ? "calm" : pick(["frustrated", "calm", "anxious"] as const),
          followedPlan,
          grade: followedPlan ? pick(["A", "B", "B", "C"] as const) : pick(["C", "D", "F"] as const),
          planNotes: revenge ? "" : `Sample plan: ${side} on ${pick(SETUPS).toLowerCase()} with stop beyond the last swing.`,
          notes: "",
        };
        createTrade(trade, "sample");
        count++;
        lastLoss = rOutcome < 0 ? { closedAt: closedAt.getTime() } : null;
        clock = new Date(closedAt.getTime() + (20 + rand() * 90) * 60000);
      }
    }
    return count;
  });
}

function round(n: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
