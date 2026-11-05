import "server-only";
import type { JarvisContext } from "./context";

const STYLE: Record<JarvisContext["coachingStyle"], string> = {
  direct: "Be brief and plain-spoken. Lead with the single most important point.",
  supportive: "Be warm and encouraging without flattering. Acknowledge effort, then get specific.",
  analytical: "Be precise and numerical. Show the figures behind each point and note sample sizes.",
};

/**
 * Stable instructions first, then the per-request record. The record is the
 * only source of facts Jarvis may use about the trader.
 */
export function systemPrompt(ctx: JarvisContext): string {
  return `You are the AI Coach, the reflective journaling companion inside Jarvis, a trading journal.

Your job is to help the trader review what they recorded, notice patterns in their own process, and think through their decisions. You are not a financial adviser, therapist or medical professional.

Rules:
- Use only the trader record below for facts about this trader. If something isn't in the record, say you don't have it. Never invent trades, figures, market prices or news.
- Jarvis gives you no market data. If asked about the market, say you can't see live prices or news here.
- Never tell the trader to buy, sell, enter, exit or size a position, and never urge them to trade. You can help them review their own plan and rules.
- Don't diagnose or describe their mental state as fact. Phrase behavioural readings as possibilities ("this could mean…"), and invite correction.
- Label claims clearly. Start lines with "Recorded:" for facts from the record, "Possible pattern:" for your inferences, and "Suggestion:" for ideas to try.
- Cite trades as [#id] using the ids in the record, so the app can link them.
- Trades marked sample=true are demo data the user loaded to try the app; mention this if you rely on them.
- Keep replies focused: usually under 200 words, with short paragraphs or bullets.
- ${STYLE[ctx.coachingStyle]}

<trader_record>
${renderRecord(ctx).replace(/</g, "\\u003c")}
</trader_record>`;
}

function renderRecord(ctx: JarvisContext): string {
  const m = ctx.metrics;
  const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  const lines = [
    `name: ${ctx.displayName || "(not set)"}`,
    `currency: ${ctx.currency}${ctx.otherCurrencies.length ? ` (totals and patterns below cover ${ctx.currency} accounts only; trades in ${ctx.otherCurrencies.join(", ")} are left out because currencies can't be added together)` : ""}`,
    `trades_recorded: ${ctx.totalTrades} (closed ${m.closedTrades}, open ${m.openTrades})${ctx.hasSampleData ? " — includes sample data" : ""}`,
    `net_pnl: ${m.netPnl}; gross_profit: ${m.grossProfit}; gross_loss: ${m.grossLoss}`,
    `win_rate: ${pct(m.winRate)}; profit_factor: ${m.profitFactor === Infinity ? "no losses" : (m.profitFactor ?? "n/a")}; expectancy_per_trade: ${m.expectancy ?? "n/a"}`,
    `avg_r: ${m.avgR ?? "n/a"} (from ${m.rSample} trades with a stop); max_drawdown: ${m.maxDrawdown}`,
    `plan_adherence: ${pct(m.planAdherence)} (from ${m.planSample} answers)`,
    `median_hold_minutes: winners ${fmt(m.holdWinnersMin)}, losers ${fmt(m.holdLosersMin)}`,
    `best_trade: ${m.bestTradeId ? `#${m.bestTradeId}` : "n/a"}; worst_trade: ${m.worstTradeId ? `#${m.worstTradeId}` : "n/a"}`,
  ];
  if (ctx.patterns.length) {
    lines.push("", "detected_patterns (rule-based, tentative):");
    for (const p of ctx.patterns)
      lines.push(`- ${p.title}: ${p.observation} [confidence ${p.confidence}; evidence ${p.evidenceTradeIds.slice(0, 12).map((i) => `#${i}`).join(" ")}]`);
  }
  if (ctx.memories.length) {
    lines.push("", "things_the_trader_asked_you_to_remember:");
    for (const mem of ctx.memories) lines.push(`- (${mem.kind}) ${mem.content}`);
  }
  if (ctx.focusTrade) lines.push("", "trade_under_review:", JSON.stringify(ctx.focusTrade));
  if (ctx.recentTrades.length) {
    lines.push("", "recent_trades (newest first, JSON lines):");
    for (const t of ctx.recentTrades) lines.push(JSON.stringify(t));
  }
  return lines.join("\n");
}

const fmt = (n: number | null) => (n === null ? "n/a" : Math.round(n));
