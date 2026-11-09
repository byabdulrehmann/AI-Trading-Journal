import "server-only";
import { z } from "zod";
import { periodRange, previousPeriod } from "@/lib/domain/progress";
import { reviewFacts, type ReviewFacts } from "@/lib/domain/review";
import type { Trade } from "@/lib/domain/types";
import { zoneDateKey } from "@/lib/domain/zone";
import { resolveActive } from "./ai/registry";
import { ProviderError } from "./ai/types";
import { db, now } from "./db";
import { recordActivity } from "./repo/activity";
import { listAccounts, listTrades } from "./repo/journal";
import { getSettings } from "./repo/settings";

export const ReviewQuery = z.object({
  period: z.enum(["week", "month"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-02"),
});

export interface SavedReview {
  provider: string;
  model: string;
  text: string;
  shared: string[];
  createdAt: string;
}

export interface Review {
  period: "week" | "month";
  from: string;
  to: string;
  /** One block per account currency: amounts in different currencies are never added together. */
  currencies: { currency: string; facts: ReviewFacts }[];
  hasSample: boolean;
  saved: SavedReview | null;
  /** Whether an AI model can write the review, and if not, why. */
  ai: { available: boolean; label: string; reason: string | null; external: boolean };
}

function periodTrades(userId: number, period: "week" | "month", date: string, includeSample: boolean) {
  const tz = getSettings(userId).timeZone || undefined;
  const range = periodRange(period, date);
  const prev = previousPeriod(period, date);
  const all = listTrades(userId, { closedOnly: true, includeSample });
  const within = (r: { from: string; to: string }) => all.filter((t) => {
    const d = zoneDateKey(t.closedAt!, tz);
    return d >= r.from && d <= r.to;
  });
  return { tz, range, current: within(range), previous: within(prev) };
}

function aiStatus(userId: number): Review["ai"] {
  const settings = getSettings(userId);
  if (!settings.jarvis.enabled) return { available: false, label: "", reason: "The AI Coach is turned off in Settings.", external: false };
  const active = resolveActive(settings);
  if (active.provider.id === "demo") return { available: false, label: "", reason: "No AI model is connected. Connect one on the AI Coach page, under Model, to have the review written.", external: false };
  return { available: true, label: `${active.provider.label}, ${active.model}`, reason: null, external: active.provider.status().external };
}

export function getReview(userId: number, period: "week" | "month", date: string, includeSample = false): Review {
  const { tz, range, current, previous } = periodTrades(userId, period, date, includeSample);
  const accounts = listAccounts(userId);
  const currencyOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency ?? "USD";
  const currencies = [...new Set([...current, ...previous].map(currencyOf))].sort();
  const row = db().prepare("SELECT * FROM ai_reviews WHERE user_id = ? AND period = ? AND start_date = ?").get(userId, period, range.from) as Record<string, string> | undefined;
  return {
    period,
    ...range,
    currencies: currencies.map((c) => ({ currency: c, facts: reviewFacts(current.filter((t) => currencyOf(t) === c), previous.filter((t) => currencyOf(t) === c), tz) })),
    hasSample: current.some((t) => t.source === "sample"),
    saved: row ? { provider: row.provider, model: row.model, text: row.text, shared: JSON.parse(row.shared), createdAt: row.created_at } : null,
    ai: aiStatus(userId),
  };
}

const SYSTEM = `You write a short review of one week or month of a trader's own journal, inside Jarvis, a trading journal.

Rules:
- Use only the record below. If something isn't in it, don't mention it. Never invent trades, figures, prices or news.
- Never tell the trader to buy, sell, enter, exit or size a position. You can point to their own process: plan, rules, mistakes, timing.
- Phrase readings of behaviour as possibilities, never as fact about their state of mind.
- Start lines with "Recorded:" for facts, "Possible pattern:" for your readings, and "Suggestion:" for one or two things to try next period.
- Cite trades as [#id]. Trades marked sample=true are demo data; say so if you use them.
- Amounts in different currencies are never added together.
- Under 220 words, short paragraphs or bullets.`;

/** Has the connected model write the review. Fails plainly when there is no model: never a canned stand-in. */
export async function writeReview(userId: number, period: "week" | "month", date: string, includeSample: boolean, signal: AbortSignal): Promise<{ ok: true; saved: SavedReview } | { ok: false; reason: string; status: number }> {
  const status = aiStatus(userId);
  if (!status.available) return { ok: false, reason: status.reason!, status: 409 };
  const settings = getSettings(userId);
  const active = resolveActive(settings);
  const review = getReview(userId, period, date, includeSample);
  if (!review.currencies.some((c) => c.facts.closedTrades > 0)) return { ok: false, reason: "No closed trades in this period, so there's nothing to review.", status: 422 };

  const { sharing } = settings.jarvis;
  const { current } = periodTrades(userId, period, date, includeSample);
  const accounts = listAccounts(userId);
  const trades = sharing === "metrics" ? [] : current.map((t) => ({
    id: t.id, symbol: t.symbol, currency: accounts.find((a) => a.id === t.accountId)?.currency, side: t.side, openedAt: t.openedAt, closedAt: t.closedAt, pnl: t.pnl, r: t.rMultiple,
    setup: t.setup || undefined, strategy: t.strategy || undefined, mistakes: t.mistakes.length ? t.mistakes : undefined, followedPlan: t.followedPlan, tags: t.tags.length ? t.tags : undefined, sample: t.source === "sample" || undefined,
    ...(sharing === "trades_with_notes" ? { notes: t.notes || undefined, lessons: t.lessons || undefined } : {}),
  }));
  const shared = [
    `Totals for ${review.from} to ${review.to} and the period before: counts, P&L, win rate, R, best and worst trade and day, plan adherence, top symbols and mistakes`,
    sharing === "metrics" ? "No individual trades (sharing set to metrics only)" : `${trades.length} closed trade(s): symbol, side, times, P&L, R, setup, strategy, mistakes, plan flag, tags${sharing === "trades_with_notes" ? ", notes and lessons" : " (no written notes)"}`,
  ];
  const record = JSON.stringify({ period, from: review.from, to: review.to, totals: review.currencies, trades }).replace(/</g, "\\u003c");

  let text = "";
  try {
    for await (const chunk of active.provider.stream({ model: active.model, system: SYSTEM, messages: [{ role: "user", content: `<record>\n${record}\n</record>\n\nWrite the review of this ${period}.` }], context: undefined as never /* only the demo responder reads it, and it never writes reviews */, signal })) {
      text += chunk;
      if (text.length > 6000) break;
    }
  } catch (err) {
    return { ok: false, reason: err instanceof ProviderError ? err.message : signal.aborted ? "The model took too long, so Jarvis stopped waiting. Try again." : "The model couldn't write the review. Try again.", status: 502 };
  }
  if (!text.trim()) return { ok: false, reason: "The model sent back nothing. Try again.", status: 502 };
  const at = now();
  db().prepare(`INSERT INTO ai_reviews (user_id, period, start_date, provider, model, text, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, period, start_date) DO UPDATE SET provider = excluded.provider, model = excluded.model, text = excluded.text, shared = excluded.shared, created_at = excluded.created_at`)
    .run(userId, period, review.from, active.provider.id, active.model, text.trim(), JSON.stringify(shared), at);
  recordActivity(userId, "review.written", { period });
  return { ok: true, saved: { provider: active.provider.id, model: active.model, text: text.trim(), shared, createdAt: at } };
}
