/**
 * Instrument conventions. Nothing here assumes a broker's contract size: that always comes
 * from the broker's symbol spec (MT5 symbol_info) or from what the user entered.
 */
export const ASSET_CLASSES = ["forex", "metal", "index", "stock", "option", "future", "cfd", "crypto", "other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "DKK", "SGD", "HKD", "ZAR", "MXN", "TRY", "PLN", "CNH"]);
const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);

/** Strips broker suffixes such as EURUSDm, XAUUSD.r or EURUSD+. */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[._+#-].*$/, "").replace(/^([A-Z]{6})[A-Z]{1,3}$/, "$1");
}

export function parsePair(symbol: string): { base: string; quote: string } | null {
  const s = normalizeSymbol(symbol);
  if (s.length !== 6) return null;
  const [base, quote] = [s.slice(0, 3), s.slice(3)];
  return (CURRENCIES.has(base) || METALS.has(base)) && CURRENCIES.has(quote) ? { base, quote } : null;
}

export function classifySymbol(symbol: string): AssetClass {
  const pair = parsePair(symbol);
  if (!pair) return "other";
  return METALS.has(pair.base) ? "metal" : "forex";
}

/**
 * The factor turning profit-currency money into account currency.
 * `null` means a rate is needed and unknown: the trade's P&L can't be stated in account currency.
 */
export function resolveFxRate(args: { symbol: string; accountCurrency: string; profitCurrency?: string | null; avgExit?: number | null; provided?: number | null }): number | null {
  if (args.provided != null) return args.provided;
  const pair = parsePair(args.symbol);
  const profit = args.profitCurrency ?? pair?.quote ?? null;
  // Indices, stocks and CFDs with no known profit currency are taken as already in account currency.
  if (!profit || profit === args.accountCurrency) return 1;
  // USDJPY in a USD account: the profit is in JPY and the trade's own exit price converts it.
  if (pair && pair.base === args.accountCurrency && pair.quote === profit && args.avgExit) return 1 / args.avgExit;
  return null;
}

/**
 * Pip size. Forex is 0.0001, or 0.01 for JPY quotes. Metals follow the convention of the
 * broker's digits, so without digits there is no answer rather than a guessed one.
 */
export function pipSize(symbol: string, digits?: number | null): number | null {
  const pair = parsePair(symbol);
  if (!pair) return null;
  if (METALS.has(pair.base)) return digits != null ? 10 ** -(digits - 1) : null;
  return pair.quote === "JPY" ? 0.01 : 0.0001;
}

export function pipsBetween(symbol: string, side: "long" | "short", entry: number, exit: number, digits?: number | null): number | null {
  const size = pipSize(symbol, digits);
  if (size === null) return null;
  return Math.round(((side === "long" ? exit - entry : entry - exit) / size) * 10) / 10;
}

export const SESSIONS = ["sydney", "tokyo", "london", "new_york", "overlap_london_ny", "off_hours"] as const;
export type MarketSession = (typeof SESSIONS)[number];

/** Session from UTC hour, standard-time windows. Labels a trade for grouping; the user can override it. */
export function sessionFor(iso: string): MarketSession {
  const hour = new Date(iso).getUTCHours();
  if (hour >= 13 && hour < 16) return "overlap_london_ny";
  if (hour >= 8 && hour < 13) return "london";
  if (hour >= 16 && hour < 21) return "new_york";
  if (hour >= 0 && hour < 8) return "tokyo";
  return "sydney";
}
