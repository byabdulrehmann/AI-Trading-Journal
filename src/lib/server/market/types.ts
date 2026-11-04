/**
 * Market-data seam. The UI only talks to this interface, so a licensed
 * provider can replace the demo one without UI changes. `dataKind` must be
 * reported honestly and is rendered on every screen that shows the data.
 */
export type DataKind = "simulated" | "delayed" | "live";

export interface Instrument {
  symbol: string;
  name: string;
  assetClass: "fx" | "index" | "commodity" | "crypto";
}

export interface Bar {
  t: string; // ISO date
  c: number; // close
}

export interface Factor {
  name: string;
  /** −1 (bearish) … +1 (bullish) */
  score: number;
  explanation: string;
}

export interface InstrumentContext {
  instrument: Instrument;
  last: number;
  changePct: number;
  bars: Bar[];
  bias: "bullish" | "bearish" | "neutral";
  /** 0–100, how strongly the factors agree. Not a probability. */
  agreement: number;
  factors: Factor[];
  asOf: string;
}

export interface CalendarEvent {
  id: string;
  at: string;
  region: string;
  title: string;
  impact: "low" | "medium" | "high";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

export interface MarketDataProvider {
  id: string;
  label: string;
  dataKind: DataKind;
  /** Short, user-facing explanation of where the data comes from. */
  disclosure: string;
  listInstruments(): Promise<Instrument[]>;
  getContext(symbol: string): Promise<InstrumentContext | null>;
  getCalendar(fromIso: string, toIso: string): Promise<CalendarEvent[]>;
}
