import type { BreakdownRow, DrawdownPoint, EquityPoint, Metrics, PeriodRow } from "@/lib/domain/metrics";
import type { PatternFinding } from "@/lib/domain/patterns";

/** What /api/analytics returns. */
export interface Analytics {
  currency: string;
  currencies: string[];
  sampleHidden: boolean;
  metrics: Metrics;
  equity: EquityPoint[];
  drawdown: DrawdownPoint[];
  periods: Record<"day" | "week" | "month" | "year", PeriodRow[]>;
  distribution: { from: number; to: number; count: number }[];
  breakdowns: Record<"symbol" | "strategy" | "side" | "session" | "weekday" | "hour" | "account" | "setup" | "emotion" | "heatmap", BreakdownRow[]>;
  patterns: PatternFinding[];
  avgR: { winners: number | null; losers: number | null };
}

/** What /api/facets returns. */
export interface Facets {
  symbols: string[];
  strategies: string[];
  tags: { name: string; kind: string }[];
  hasSample: boolean;
}
