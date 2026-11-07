import type { BreakdownRow, DrawdownPoint, EquityPoint, Metrics, ExcursionStats, PeriodRow, RiskReport, Score, SideProfile, Unit } from "@/lib/domain/metrics";
import type { PatternFinding } from "@/lib/domain/patterns";

/** What /api/analytics returns. */
export interface Analytics {
  currency: string;
  currencies: string[];
  unit: Unit;
  /** The currency, or %, R or pips: what figures below are stated in. */
  display: string;
  unitNote: string | null;
  /** Always in money. The score reads these, so it doesn't change with the unit. */
  moneyMetrics: Metrics;
  score: Score;
  sampleHidden: boolean;
  metrics: Metrics;
  equity: EquityPoint[];
  drawdown: DrawdownPoint[];
  periods: Record<"day" | "week" | "month" | "year", PeriodRow[]>;
  distribution: { from: number; to: number; count: number }[];
  breakdowns: Record<"symbol" | "strategy" | "side" | "session" | "weekday" | "hour" | "account" | "setup" | "emotion" | "heatmap" | "month" | "plan" | "assetClass" | "grade" | "tag" | "mistake" | "hold" | "rMultiple" | "price" | "size", BreakdownRow[]>;
  patterns: PatternFinding[];
  report: { profile: { wins: SideProfile; losses: SideProfile }; streaks: { length: number; wins: number; losses: number }[]; risk: RiskReport; excursions: ExcursionStats; unread: number };
  avgR: { winners: number | null; losers: number | null };
}

/** What /api/facets returns. */
export interface Facets {
  symbols: string[];
  strategies: string[];
  tags: { name: string; kind: string }[];
  hasSample: boolean;
}
