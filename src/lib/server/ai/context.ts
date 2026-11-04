import "server-only";
import { computeMetrics, reportingCurrencies, tradesInCurrency, type Metrics } from "@/lib/domain/metrics";
import { detectPatterns, type PatternFinding } from "@/lib/domain/patterns";
import type { Memory, Settings, Trade } from "@/lib/domain/types";
import { getTrade, listAccounts, listTrades } from "../repo/journal";
import { listMemories } from "../repo/jarvis";

/**
 * Builds the minimum context Jarvis needs, limited by the user's sharing
 * setting. The same object drives the demo provider and the prompt for
 * external providers, and `disclosure` tells the user exactly what was sent.
 */
export interface ContextTrade {
  id: number;
  symbol: string;
  currency: string;
  side: string;
  openedAt: string;
  closedAt: string | null;
  pnl: number | null;
  r: number | null;
  plannedR: number | null;
  setup: string;
  emotionBefore: string | null;
  emotionAfter: string | null;
  followedPlan: boolean | null;
  grade: string | null;
  sample: boolean;
  planNotes?: string;
  notes?: string;
}

export interface JarvisContext {
  coachingStyle: Settings["jarvis"]["coachingStyle"];
  displayName: string;
  currency: string;
  /** Other currencies with trades, left out of the metrics and patterns because they can't be added together. */
  otherCurrencies: string[];
  metrics: Omit<Metrics, "bestTrade" | "worstTrade"> & { bestTradeId: number | null; worstTradeId: number | null };
  patterns: PatternFinding[];
  recentTrades: ContextTrade[];
  focusTrade: ContextTrade | null;
  memories: Pick<Memory, "id" | "kind" | "content">[];
  hasSampleData: boolean;
  totalTrades: number;
  disclosure: string[];
}

const RECENT_LIMIT = 25;

function toContextTrade(t: Trade, currency: string, withNotes: boolean): ContextTrade {
  return {
    id: t.id,
    symbol: t.symbol,
    currency,
    side: t.side,
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    pnl: t.pnl,
    r: t.rMultiple,
    plannedR: t.plannedR,
    setup: t.setup,
    emotionBefore: t.emotionBefore,
    emotionAfter: t.emotionAfter,
    followedPlan: t.followedPlan,
    grade: t.grade,
    sample: t.source === "sample",
    ...(withNotes ? { planNotes: t.planNotes, notes: t.notes } : {}),
  };
}

export function buildContext(settings: Settings, focusTradeId?: number | null): JarvisContext {
  const { sharing, memoryEnabled, behaviouralInsights, coachingStyle } = settings.jarvis;
  const trades = listTrades();
  const accounts = listAccounts();
  const { currencies, primary } = reportingCurrencies(accounts, trades);
  const currency = primary ?? settings.baseCurrency;
  const reported = tradesInCurrency(trades, accounts, currency);
  const otherCurrencies = currencies.filter((c) => c !== currency);
  const currencyOf = (t: Trade) => accounts.find((a) => a.id === t.accountId)?.currency ?? currency;
  const { bestTrade, worstTrade, ...metrics } = computeMetrics(reported);
  const withTrades = sharing !== "metrics";
  const withNotes = sharing === "trades_with_notes";
  const patterns = behaviouralInsights
    ? detectPatterns(reported).filter((p) => !settings.dismissedPatterns.includes(p.id))
    : [];
  const memories = memoryEnabled ? listMemories(true).map(({ id, kind, content }) => ({ id, kind, content })) : [];
  const focus = focusTradeId ? getTrade(focusTradeId) : null;

  const disclosure = [
    `Summary metrics (counts, P&L totals, win rate, R statistics)${otherCurrencies.length ? ` for your ${currency} accounts only` : ""}`,
    behaviouralInsights ? `${patterns.length} detected pattern(s) with their evidence trade ids` : "No behavioural patterns (turned off)",
    withTrades
      ? `Up to ${RECENT_LIMIT} recent trades: symbol, currency, side, times, P&L, R, setup, emotions, plan flag, grade${withNotes ? ", and your written notes" : " (no written notes)"}`
      : "No individual trades (sharing set to metrics only)",
    memoryEnabled ? `${memories.length} active memory item(s)` : "No memories (memory turned off)",
    focus ? `The trade you asked about (#${focus.id})` : null,
    "Your coaching style preference and display name",
  ].filter((x): x is string => x !== null);

  return {
    coachingStyle,
    displayName: settings.displayName,
    currency,
    otherCurrencies,
    metrics: { ...metrics, bestTradeId: bestTrade?.id ?? null, worstTradeId: worstTrade?.id ?? null },
    patterns,
    recentTrades: withTrades ? trades.slice(0, RECENT_LIMIT).map((t) => toContextTrade(t, currencyOf(t), withNotes)) : [],
    focusTrade: focus ? toContextTrade(focus, currencyOf(focus), withNotes) : null,
    memories,
    hasSampleData: trades.some((t) => t.source === "sample"),
    totalTrades: reported.length,
    disclosure,
  };
}
