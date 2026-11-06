import "server-only";
import { insertSampleDays } from "./repo/daily";
import { createAccount, hasSampleData, insertSampleTrades, listStrategies } from "./repo/journal";
import { db, now, transaction } from "./db";
import { MissedInput, PLAYBOOK_TEMPLATES } from "@/lib/domain/playbooks";
import { EMOTIONS, TradeInput, type DailyInput, type TradeData } from "@/lib/domain/types";
import type { AssetClass } from "@/lib/domain/engine/instruments";

/**
 * Made-up journal for exploring the app: several accounts, asset classes and strategies across
 * nine months. Every row is stored with source = 'sample' on accounts flagged is_sample and shown
 * with a "Sample" badge. It never mixes silently with the user's records and Settings removes it.
 */
interface Instrument {
  symbol: string;
  assetClass: AssetClass;
  price: number;
  /** One step of risk, in price. */
  tick: number;
  sizes: number[];
  multiplier: number;
  dp: number;
  option?: { right: "call" | "put"; strike: number };
}

const BOOKS: { name: string; broker: string; balance: number; instruments: Instrument[] }[] = [
  {
    name: "Sample FX and CFD",
    broker: "Sample data",
    balance: 25000,
    instruments: [
      { symbol: "EURUSD", assetClass: "forex", price: 1.085, tick: 0.0004, sizes: [0.5, 1, 2], multiplier: 100000, dp: 5 },
      { symbol: "GBPUSD", assetClass: "forex", price: 1.27, tick: 0.0005, sizes: [0.5, 1], multiplier: 100000, dp: 5 },
      { symbol: "XAUUSD", assetClass: "metal", price: 2650, tick: 3.5, sizes: [0.1, 0.2, 0.5], multiplier: 100, dp: 2 },
      { symbol: "US100", assetClass: "index", price: 20500, tick: 25, sizes: [1, 2, 3], multiplier: 1, dp: 2 },
    ],
  },
  {
    name: "Sample stocks and options",
    broker: "Sample data",
    balance: 40000,
    instruments: [
      { symbol: "AAPL", assetClass: "stock", price: 190, tick: 0.6, sizes: [50, 100, 200], multiplier: 1, dp: 2 },
      { symbol: "NVDA", assetClass: "stock", price: 135, tick: 0.8, sizes: [50, 100], multiplier: 1, dp: 2 },
      { symbol: "TSLA", assetClass: "stock", price: 250, tick: 1.5, sizes: [20, 50], multiplier: 1, dp: 2 },
      { symbol: "AAPL C190", assetClass: "option", price: 6, tick: 0.2, sizes: [1, 2, 5], multiplier: 100, dp: 2, option: { right: "call", strike: 190 } },
      { symbol: "SPY P580", assetClass: "option", price: 7, tick: 0.25, sizes: [1, 2, 3], multiplier: 100, dp: 2, option: { right: "put", strike: 580 } },
    ],
  },
  {
    name: "Sample futures and crypto",
    broker: "Sample data",
    balance: 50000,
    instruments: [
      { symbol: "ES", assetClass: "future", price: 5900, tick: 2.5, sizes: [1, 2], multiplier: 50, dp: 2 },
      { symbol: "NQ", assetClass: "future", price: 20500, tick: 12, sizes: [1], multiplier: 20, dp: 2 },
      { symbol: "BTCUSD", assetClass: "crypto", price: 68000, tick: 350, sizes: [0.05, 0.1, 0.2], multiplier: 1, dp: 2 },
      { symbol: "ETHUSD", assetClass: "crypto", price: 3400, tick: 25, sizes: [0.5, 1], multiplier: 1, dp: 2 },
    ],
  },
];

const STRATEGIES = ["Opening range breakout", "VWAP pullback", "Range fade", "Trend continuation", "News drift"];
const TAGS = ["A+ setup", "High volume", "Morning", "Afternoon", "Earnings week", "Scaled out"];
const OFF_PLAN_MISTAKES = ["moved_stop", "oversized", "chased_entry", "early_exit", "late_exit", "against_plan", "fomo"] as const;
const DAYS_BACK = 270;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const iso = (ms: number) => new Date(ms).toISOString();

export function buildSampleTrades(accountIds: number[], today: Date): TradeData[] {
  const rand = rng(20261103);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const trades: TradeData[] = [];
  let lastLoss: { closedAt: number; book: number } | null = null;

  for (let back = DAYS_BACK; back >= 1; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    if (day.getDay() === 0 || day.getDay() === 6) continue;

    BOOKS.forEach((book, b) => {
      if (rand() < 0.35) return;
      const perDay = rand() < 0.12 ? 5 : 1 + Math.floor(rand() * 2);
      let clock = new Date(day).setHours(8 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);

      for (let n = 0; n < perDay; n++) {
        const ins = pick(book.instruments);
        const side: "long" | "short" = rand() < 0.55 ? "long" : "short";
        const dir = side === "long" ? 1 : -1;
        const steps = 4 + Math.floor(rand() * 4);
        const entry = round(ins.price * (1 + (rand() - 0.5) * 0.02), ins.dp);
        const stop = round(entry - dir * steps * ins.tick, ins.dp);
        const target = round(entry + dir * steps * ins.tick * 2, ins.dp);

        // Re-entry right after a loss with bigger size: plants what the pattern detectors look for.
        const revenge: boolean = lastLoss !== null && lastLoss.book === b && rand() < 0.5;
        if (revenge && lastLoss) clock = lastLoss.closedAt + (3 + rand() * 9) * 60000;
        const size = pick(ins.sizes) * (revenge ? 2 : 1);

        const roll = rand();
        let outcome: number;
        let holdMin: number;
        if (revenge) {
          outcome = roll < 0.35 ? 1 + rand() : -1 - rand() * 0.5;
          holdMin = 10 + rand() * 40;
        } else if (roll < 0.56) {
          outcome = rand() < 0.45 ? 0.4 + rand() * 0.4 : 1.5 + rand() * 0.6; // some early exits
          holdMin = rand() < 0.1 ? 1500 + rand() * 3000 : 15 + rand() * 60;
        } else {
          outcome = rand() < 0.25 ? -1.3 - rand() * 0.5 : -1;
          holdMin = 60 + rand() * 180; // losers held longer
        }
        const exit = round(entry + dir * outcome * steps * ins.tick, ins.dp);
        const closedAt = clock + holdMin * 60000;
        if (closedAt >= today.getTime()) break; // Nothing closes in the future.
        const followedPlan = revenge ? false : outcome < -1.2 ? false : rand() < 0.85;
        const strategy = revenge ? "" : pick(STRATEGIES);

        // One in six scales out: half at a nearer price, the rest at the final exit.
        const scaled = outcome > 0.5 && rand() < 0.33 && size > 0.1;
        const halfway = round(entry + (exit - entry) * 0.5, ins.dp);
        const executions = scaled
          ? [
              { role: "entry" as const, price: entry, quantity: size, executedAt: iso(clock) },
              { role: "exit" as const, price: halfway, quantity: size / 2, executedAt: iso(clock + holdMin * 30000) },
              { role: "exit" as const, price: exit, quantity: size / 2, executedAt: iso(closedAt) },
            ]
          : null;

        trades.push(
          TradeInput.parse({
            accountId: accountIds[b],
            symbol: ins.symbol,
            side,
            assetClass: ins.assetClass,
            optionRight: ins.option?.right ?? null,
            strike: ins.option?.strike ?? null,
            expiry: ins.option ? iso(new Date(day).setDate(day.getDate() + 30)).slice(0, 10) : null,
            openedAt: iso(clock),
            closedAt: iso(closedAt),
            entryPrice: entry,
            exitPrice: exit,
            quantity: size,
            multiplier: ins.multiplier,
            stopPrice: stop,
            targetPrice: target,
            commission: round(1 + rand() * 7, 2),
            swap: holdMin > 1440 ? round(rand() * 6, 2) : 0,
            executions,
            strategy,
            setup: strategy ? pick(["First pullback", "Second attempt", "Level retest", "Momentum"]) : "",
            tags: revenge ? ["Unplanned"] : [...(scaled ? ["Scaled out"] : []), ...(rand() < 0.4 ? [pick(TAGS)] : [])].filter((t, i, all) => all.indexOf(t) === i),
            emotionBefore: revenge ? pick(["frustrated", "impatient"] as const) : pick(EMOTIONS.slice(0, 4)),
            emotionAfter: outcome > 0 ? "calm" : pick(["frustrated", "calm", "anxious"] as const),
            followedPlan,
            grade: followedPlan ? pick(["A", "B", "B", "C"] as const) : pick(["C", "D", "F"] as const),
            mistakes: followedPlan ? [] : [pick(OFF_PLAN_MISTAKES)],
            confidence: 1 + Math.floor(rand() * 5),
            discipline: followedPlan ? 3 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2),
            revengeTrade: revenge,
            planNotes: revenge ? "" : `Sample plan: ${side} on ${strategy.toLowerCase()} with the stop beyond the last swing.`,
            notes: rand() < 0.2 ? "Sample note: not a real trade." : "",
          }),
        );
        lastLoss = outcome < 0 ? { closedAt, book: b } : null;
        clock = closedAt + (20 + rand() * 90) * 60000;
      }
    });
  }

  // A few still open, so open-position states have something to show.
  BOOKS.forEach((book, b) => {
    const ins = book.instruments[0];
    trades.push(TradeInput.parse({
      accountId: accountIds[b],
      symbol: ins.symbol,
      side: "long",
      assetClass: ins.assetClass,
      optionRight: ins.option?.right ?? null,
      openedAt: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 9, 30).getTime()),
      entryPrice: ins.price,
      quantity: ins.sizes[0],
      multiplier: ins.multiplier,
      stopPrice: round(ins.price - 5 * ins.tick, ins.dp),
      strategy: STRATEGIES[0],
      planNotes: "Sample plan: still open.",
    }));
  });
  return trades;
}

/**
 * Flags the strategies the sample just created, then gives them rules, answers and missed trades. A strategy the user
 * already had keeps its own rules: the sample's trades may share its name, but nothing else is added to it.
 */
function seedPlaybooks(userId: number, before: Set<string>, today: Date) {
  const rand = rng(20261105);
  const conn = db();
  transaction(conn, () => {
    for (const s of listStrategies(userId)) {
      if (before.has(s.name)) continue;
      const template = PLAYBOOK_TEMPLATES.find((t) => t.name === s.name);
      conn.prepare("UPDATE strategies SET is_sample = 1, description = ? WHERE id = ?").run(template?.description ?? "", s.id);
      const rule = conn.prepare("INSERT INTO strategy_rules (strategy_id, group_name, text, position) VALUES (?, ?, ?, ?)");
      template?.rules.forEach((r, i) => rule.run(s.id, r.group, r.text, i));
      const rules = (conn.prepare("SELECT id FROM strategy_rules WHERE strategy_id = ?").all(s.id) as { id: number }[]).map((r) => r.id);
      const trades = conn.prepare("SELECT id, followed_plan FROM trades WHERE user_id = ? AND source = 'sample' AND strategy_id = ?").all(userId, s.id) as { id: number; followed_plan: number | null }[];
      const check = conn.prepare("INSERT INTO trade_rule_checks (trade_id, rule_id, checked) VALUES (?, ?, ?)");
      for (const t of trades) {
        if (rand() > 0.6) continue;
        // On-plan trades followed every rule. Off-plan ones missed one.
        const missed = t.followed_plan === 1 ? -1 : Math.floor(rand() * rules.length);
        rules.forEach((id, i) => check.run(t.id, id, i === missed ? 0 : 1));
      }
      const addMissed = conn.prepare("INSERT INTO missed_trades (user_id, strategy_id, symbol, side, at, entry_price, stop_price, exit_price, reason, is_sample, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)");
      for (let i = 0; i < 4; i++) {
        const side = rand() < 0.5 ? "long" : "short";
        const dir = side === "long" ? 1 : -1;
        const entry = Math.round((100 + rand() * 100) * 100) / 100;
        const m = MissedInput.parse({
          strategyId: s.id,
          symbol: ["AAPL", "NVDA", "ES", "EURUSD"][i],
          side,
          at: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2 - Math.floor(rand() * 60), 10).toISOString(),
          entryPrice: entry,
          stopPrice: Math.round((entry - dir * 2) * 100) / 100,
          exitPrice: Math.round((entry + dir * (rand() * 8 - 2)) * 100) / 100,
          reason: ["Sample: hesitated at the level", "Sample: was away from the screen", "Sample: already at my daily limit", "Sample: didn't trust the setup"][i],
        });
        addMissed.run(userId, s.id, m.symbol, m.side, m.at, m.entryPrice, m.stopPrice, m.exitPrice, m.reason, now());
      }
    }
  });
}

/** A folder of made-up notes, linked to sample days and trades. */
function seedNotes(userId: number) {
  const conn = db();
  transaction(conn, () => {
    if (conn.prepare("SELECT 1 FROM note_folders WHERE user_id = ? AND name = 'Sample notes'").get(userId)) return;
    const folder = Number(conn.prepare("INSERT INTO note_folders (user_id, name, is_sample, created_at) VALUES (?, 'Sample notes', 1, ?)").run(userId, now()).lastInsertRowid);
    const trades = conn.prepare("SELECT id, symbol, net_pnl FROM trades WHERE user_id = ? AND source = 'sample' AND status = 'closed' ORDER BY net_pnl LIMIT 2").all(userId) as { id: number; symbol: string }[];
    const days = conn.prepare("SELECT date FROM daily_journal WHERE user_id = ? AND is_sample = 1 ORDER BY date DESC LIMIT 2").all(userId) as { date: string }[];
    const write = conn.prepare("INSERT INTO notes (user_id, folder_id, title, body, tags, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)");
    const link = conn.prepare("INSERT INTO note_links (note_id, trade_id, day) VALUES (?, ?, ?)");
    const add = (title: string, body: string, tags: string[]) => Number(write.run(userId, folder, title, body, JSON.stringify(tags), now(), now()).lastInsertRowid);
    const plan = PLAYBOOK_TEMPLATES[0];
    add("Sample: my trading plan", `## Setups I take\n\n- ${plan.name}\n- Trend continuation\n\n## Most I can lose\n\n- Per trade: **1%**\n- Per day: **3%**\n\n## When I stop for the day\n\n- [ ] Two losses in a row\n- [x] Daily limit reached`, ["plan"]);
    const loss = add("Sample: recap of my worst trade", `## What happened\n\nMade-up example. I moved my stop on [#${trades[0]?.id ?? 0}] and it cost far more than planned.\n\n## What changes next time\n\n- [ ] The stop stays where the plan put it`, ["recap", "discipline"]);
    for (const t of trades.slice(0, 1)) link.run(loss, t.id, null);
    const week = add("Sample: weekly review", "## Best trade\n\nMade-up example. Waited for the close and let it run.\n\n## What I'll work on\n\n- [ ] Fewer trades on Mondays", ["review"]);
    for (const d of days) link.run(week, null, d.date);
  });
}

/** Made-up notes for most recent weekdays, so the daily journal has something to show. */
export function buildSampleDays(today: Date): DailyInput[] {
  const rand = rng(20261104);
  const days: DailyInput[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let back = 45; back >= 1; back--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    if (d.getDay() === 0 || d.getDay() === 6 || rand() < 0.3) continue;
    days.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      plan: `Sample plan: ${rand() < 0.5 ? "trend day expected" : "range day expected"}. Trade the first pullback only. Stop after two losses.`,
      recap: rand() < 0.8 ? `Sample recap: ${rand() < 0.5 ? "stuck to the plan and left the rest" : "took one trade outside the plan, cost more than it should have"}.` : "",
      rating: 1 + Math.floor(rand() * 5),
    });
  }
  return days;
}

export function loadSampleData(userId: number): number {
  if (hasSampleData(userId)) return 0;
  const before = new Set(listStrategies(userId).map((s) => s.name));
  const ids = BOOKS.map((b) => createAccount(userId, { name: b.name, broker: b.broker, currency: "USD", startingBalance: b.balance }, { isSample: true }).id);
  const trades = buildSampleTrades(ids, new Date());
  insertSampleTrades(userId, trades);
  insertSampleDays(userId, buildSampleDays(new Date()));
  seedPlaybooks(userId, before, new Date());
  seedNotes(userId);
  return trades.length;
}
