import { abs, add, dec, div, mul, sub, sum, toNumber, ZERO, type Dec } from "./decimal";
import { resolveFxRate } from "./instruments";

/**
 * The one place trade money is calculated. Manual, CSV and MT5 trades all pass through here.
 *
 * gross   = Σ exits (exit − weighted avg entry) × direction × qty × contract size × fx
 * net     = gross − commission − swap − other fees   (positive cost, negative credit)
 * risk    = |weighted avg entry − stop| × entered qty × contract size × fx
 * R       = net ÷ risk
 *
 * When the broker reports realized profit (MT5), that figure is the gross: the broker
 * already applied its own contract size and conversion, so nothing is re-derived.
 */
export interface Fill {
  price: number;
  qty: number;
}

export interface PositionInput {
  side: "long" | "short";
  symbol: string;
  accountCurrency: string;
  profitCurrency?: string | null;
  contractSize: number;
  fxRate?: number | null;
  entries: Fill[];
  exits: Fill[];
  commission?: number;
  swap?: number;
  otherFees?: number;
  stopPrice?: number | null;
  targetPrice?: number | null;
  /** Realized profit reported by the broker, already in account currency. */
  brokerProfit?: number | null;
}

export type PositionStatus = "open" | "partial" | "closed";
/** ok: stated in account currency. needs_rate: a conversion rate is missing. over_closed: exits exceed entries. */
export type PnlStatus = "ok" | "needs_rate" | "over_closed";

export interface PositionResult {
  status: PositionStatus;
  pnlStatus: PnlStatus;
  avgEntry: number;
  avgExit: number | null;
  enteredQty: number;
  exitedQty: number;
  remainingQty: number;
  grossPnl: number | null;
  netPnl: number | null;
  totalCosts: number;
  initialRisk: number | null;
  rMultiple: number | null;
  plannedR: number | null;
}

function weightedAverage(fills: Fill[]): { avg: Dec; qty: Dec } {
  const qty = sum(fills.map((f) => dec(f.qty)));
  if (qty === ZERO) return { avg: ZERO, qty };
  return { avg: div(sum(fills.map((f) => mul(dec(f.price), dec(f.qty)))), qty), qty };
}

export function computePosition(p: PositionInput): PositionResult {
  const { avg: avgEntry, qty: entered } = weightedAverage(p.entries);
  const { avg: avgExit, qty: exited } = weightedAverage(p.exits);
  const remaining = sub(entered, exited);
  const direction = dec(p.side === "long" ? 1 : -1);
  const size = dec(p.contractSize);
  const costs = sum([p.commission ?? 0, p.swap ?? 0, p.otherFees ?? 0].map(dec));
  const hasExits = p.exits.length > 0;
  const avgExitNumber = hasExits ? toNumber(avgExit, 8) : null;

  // An open USDJPY position has no exit yet, so its entry price stands in for the conversion.
  const rate = resolveFxRate({ symbol: p.symbol, accountCurrency: p.accountCurrency, profitCurrency: p.profitCurrency, avgExit: avgExitNumber ?? toNumber(avgEntry, 8), provided: p.fxRate });
  const inProfitCurrency = sum(p.exits.map((f) => mul(mul(mul(sub(dec(f.price), avgEntry), direction), dec(f.qty)), size)));

  let gross: Dec | null = null;
  if (p.brokerProfit != null) gross = dec(p.brokerProfit);
  else if (hasExits && rate !== null) gross = mul(inProfitCurrency, dec(rate));
  const net = gross === null ? null : sub(gross, costs);

  // For broker trades in a foreign profit currency, the broker's own figure implies the rate it used.
  const riskRate = rate !== null ? dec(rate) : gross !== null && inProfitCurrency !== ZERO ? abs(div(gross, inProfitCurrency)) : null;

  let risk: Dec | null = null;
  if (p.stopPrice != null && riskRate !== null) {
    const r = mul(mul(mul(abs(sub(avgEntry, dec(p.stopPrice))), entered), size), riskRate);
    risk = r > ZERO ? r : null;
  }

  const stopDistance = p.stopPrice != null ? abs(sub(avgEntry, dec(p.stopPrice))) : ZERO;
  const plannedR = p.targetPrice != null && stopDistance > ZERO ? toNumber(div(abs(sub(dec(p.targetPrice), avgEntry)), stopDistance), 2) : null;

  return {
    status: !hasExits ? "open" : remaining > ZERO ? "partial" : "closed",
    pnlStatus: remaining < ZERO ? "over_closed" : hasExits && gross === null ? "needs_rate" : "ok",
    avgEntry: toNumber(avgEntry, 8),
    avgExit: avgExitNumber,
    enteredQty: toNumber(entered, 8),
    exitedQty: toNumber(exited, 8),
    remainingQty: toNumber(remaining, 8),
    grossPnl: gross === null ? null : toNumber(gross),
    netPnl: net === null ? null : toNumber(net),
    totalCosts: toNumber(costs),
    initialRisk: risk === null ? null : toNumber(risk),
    rMultiple: risk !== null && net !== null ? toNumber(div(net, risk)) : null,
    plannedR,
  };
}

/** Adds money without float error. */
export function addMoney(values: number[]): number {
  return toNumber(values.reduce((t: Dec, v) => add(t, dec(v)), ZERO));
}
