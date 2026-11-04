import "server-only";
import type { JarvisContext } from "../context";
import type { JarvisProvider, StreamRequest } from "../types";

/**
 * Demo mode: no model, no network. Replies are assembled from the trader's
 * own computed record with fixed templates, so nothing is invented. It
 * streams word by word to exercise the same UI path as a real provider.
 */
export const demoProvider: JarvisProvider = {
  id: "demo",
  label: "Demo mode (no AI model)",
  defaultModel: "kestrel-demo",
  status: () => ({ configured: true, external: false }),
  async listModels() {
    return [{ id: "kestrel-demo", displayName: "Kestrel demo responder (templated, offline)" }];
  },
  async *stream(req: StreamRequest) {
    const text = compose(req.messages.at(-1)?.content ?? "", req.context);
    for (const piece of text.split(/(\s+)/)) {
      if (req.signal.aborted) return;
      await new Promise((r) => setTimeout(r, 12));
      yield piece;
    }
  },
};

const money = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function compose(question: string, ctx: JarvisContext): string {
  const q = question.toLowerCase();
  const m = ctx.metrics;
  const intro = "_Demo mode: this reply is built from your records with fixed templates, not by an AI model. Connect a provider in Settings for real conversation._\n\n";
  if (m.closedTrades === 0)
    return `${intro}Recorded: there are no closed trades in your journal yet, so I have nothing to review.\n\nSuggestion: add a trade in the Journal, import a CSV, or load the sample journal from Settings to try things out.`;

  const sampleNote = ctx.hasSampleData ? "\n\n(Some of these records are sample data.)" : "";

  if (ctx.focusTrade) {
    const t = ctx.focusTrade;
    const lines = [
      `Recorded: [#${t.id}] ${t.side} ${t.symbol}, ${t.pnl === null ? "still open" : `closed at ${money(t.pnl)}`}${t.r !== null ? ` (${t.r}R)` : ""}.`,
      t.plannedR !== null ? `Recorded: you planned for ${t.plannedR}R.` : "Recorded: no stop and target were saved, so planned R isn't available.",
      t.followedPlan === null ? "Recorded: you didn't mark whether you followed the plan." : `Recorded: you marked this trade as ${t.followedPlan ? "on plan" : "off plan"}.`,
      t.emotionBefore ? `Recorded: you felt ${t.emotionBefore} going in${t.emotionAfter ? ` and ${t.emotionAfter} afterwards` : ""}.` : "",
      t.r !== null && t.plannedR !== null && t.r > 0 && t.r < t.plannedR / 2
        ? "Possible pattern: the exit came well before the planned target. That might have been a good read, or an early exit — your notes would tell."
        : "",
      t.r !== null && t.r < -1.2 ? "Possible pattern: the loss went past your planned risk. Worth checking whether the stop moved or slipped." : "",
      "Suggestion: write one sentence on why you exited where you did, so later reviews can compare intent and outcome.",
    ];
    return intro + lines.filter(Boolean).join("\n\n") + sampleNote;
  }

  if (/pattern|habit|behav|mistake|tax|psycholog/.test(q)) {
    if (!ctx.patterns.length)
      return `${intro}Recorded: none of the pattern rules currently fire on your ${m.closedTrades} closed trades (or behavioural insights are turned off).\n\nSuggestion: keep marking emotions and plan adherence — most rules need a few weeks of entries.${sampleNote}`;
    const items = ctx.patterns.slice(0, 3).map(
      (p) => `Possible pattern: **${p.title}** — ${p.observation} Evidence: ${p.evidenceTradeIds.slice(0, 5).map((i) => `[#${i}]`).join(" ")}`,
    );
    return `${intro}${items.join("\n\n")}\n\nSuggestion: ${ctx.patterns[0].suggestion}${sampleNote}`;
  }

  if (/plan|rule|discipline/.test(q))
    return `${intro}Recorded: you answered the plan question on ${m.planSample} trades and marked ${pct(m.planAdherence)} of them as on plan.\n\nSuggestion: pick one rule to watch this week and note it in the plan field before each trade.${sampleNote}`;

  const best = m.bestTradeId ? ` Best trade [#${m.bestTradeId}], worst [#${m.worstTradeId}].` : "";
  return `${intro}Recorded: across all ${m.closedTrades} closed trades in your journal (demo mode can't filter by date), net ${money(m.netPnl)} ${ctx.currency}, win rate ${pct(m.winRate)}, average ${m.avgR ?? "n/a"}R from ${m.rSample} trades with a stop.${best}\n\n${
    ctx.patterns[0] ? `Possible pattern: ${ctx.patterns[0].title.toLowerCase()} — see the Patterns page for the evidence.\n\n` : ""
  }Suggestion: ask me about your patterns, your plan adherence, or open a trade and choose "Review with Jarvis".${sampleNote}`;
}
