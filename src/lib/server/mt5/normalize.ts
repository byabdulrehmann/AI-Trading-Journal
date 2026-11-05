/**
 * Turns raw MT5 deals into journal trades. Pure: no database, no clock.
 *
 * Field names are those of the MetaTrader5 package 5.0.6180 (checked with TradeDeal._fields).
 * TradeDeal has no sl or tp field, so the initial stop normally comes from the opening order.
 * Deal shapes and cost signs have not been checked against a real account.
 */
export interface RawDeal {
  ticket: number;
  order: number;
  time: number;
  time_msc: number;
  type: number;
  entry: number;
  position_id: number;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  fee: number;
  symbol: string;
  sl?: number;
  tp?: number;
  [key: string]: unknown;
}

export interface RawOrder {
  ticket: number;
  position_id: number;
  sl: number;
  tp: number;
  [key: string]: unknown;
}

const BUY = 0;
const SELL = 1;
const BUY_CANCELED = 13;
const SELL_CANCELED = 14;
const IN = 0;
const OUT = 1;
const INOUT = 2;
const OUT_BY = 3;

export interface NormalizedFill {
  role: "entry" | "exit";
  price: number;
  quantity: number;
  executedAt: string;
  commission: number;
  swap: number;
  fee: number;
  profit: number;
  /** Unique per account. A reversal deal fills two rows, and its opening part carries ":open". */
  brokerDealId: string;
  brokerOrderId: string;
  brokerPositionId: string;
  /** The deal exactly as MT5 returned it. */
  raw: string;
}

export interface NormalizedTrade {
  sourceKey: string;
  positionId: string;
  symbol: string;
  side: "long" | "short";
  stopPrice: number | null;
  targetPrice: number | null;
  commission: number;
  swap: number;
  otherFees: number;
  brokerProfit: number;
  fills: NormalizedFill[];
}

export interface IncompletePosition {
  positionId: string;
  reason: string;
}

export interface NormalizeResult {
  trades: NormalizedTrade[];
  incomplete: IncompletePosition[];
  /** Balance, credit, commission and similar account entries: not trades. */
  nonTrade: number;
  /** Positions with a cancelled deal: excluded from the trade, which needs the user's review. */
  cancelled: string[];
}

const round = (n: number) => Math.round(n * 1e8) / 1e8;
/** MT5 reports a charge as negative, Jarvis stores a cost as positive. The one place this flips. */
const cost = (mt5Value: number | undefined) => round(0 - (mt5Value ?? 0));

/** 0 means "no level" in MT5, and a stop on the wrong side of entry isn't valid initial risk. */
function validStop(side: "long" | "short", entry: number, stop: number | undefined): number | null {
  if (!stop) return null;
  return (side === "long" ? stop < entry : stop > entry) ? stop : null;
}

interface Segment {
  side: "long" | "short";
  open: number;
  fills: NormalizedFill[];
  first: RawDeal;
}

function fill(d: RawDeal, role: "entry" | "exit", quantity: number, share: number, offsetSeconds: number, part: "" | ":open" = ""): NormalizedFill {
  const seconds = d.time_msc ? d.time_msc / 1000 : d.time;
  return {
    role,
    price: d.price,
    quantity: round(quantity),
    executedAt: new Date((seconds - offsetSeconds) * 1000).toISOString(),
    commission: round(cost(d.commission) * share),
    // Swap and profit belong to the position being closed, so a reversal's opening part carries none.
    swap: part ? 0 : cost(d.swap),
    fee: round(cost(d.fee) * share),
    profit: part ? 0 : d.profit,
    brokerDealId: `${d.ticket}${part}`,
    brokerOrderId: String(d.order),
    brokerPositionId: String(d.position_id),
    raw: JSON.stringify(d),
  };
}

const sideOf = (d: RawDeal) => (d.type === BUY ? "long" : "short");
const flat = (s: Segment | undefined) => !s || s.open < 1e-8;

/** Returns the segments of one position, or a reason it can't be trusted. One identifier can hold two trades. */
function segments(deals: RawDeal[], offsetSeconds: number): Segment[] | string {
  const out: Segment[] = [];
  for (const d of deals) {
    const cur = out.at(-1);
    if (d.entry === IN) {
      if (flat(cur)) out.push({ side: sideOf(d), open: 0, fills: [], first: d });
      const s = out.at(-1)!;
      s.open = round(s.open + d.volume);
      s.fills.push(fill(d, "entry", d.volume, 1, offsetSeconds));
    } else if (d.entry === OUT || d.entry === OUT_BY) {
      if (flat(cur)) return "exit with no opening deal in the fetched history";
      if (round(d.volume - cur!.open) > 0) return "exits exceed entries";
      cur!.open = round(cur!.open - d.volume);
      cur!.fills.push(fill(d, "exit", d.volume, 1, offsetSeconds));
    } else if (d.entry === INOUT) {
      if (flat(cur)) return "reversal with no opening deal in the fetched history";
      const closing = cur!.open;
      const opening = round(d.volume - closing);
      if (opening < 0) return "reversal smaller than the position it closes";
      cur!.fills.push(fill(d, "exit", closing, closing / d.volume, offsetSeconds));
      cur!.open = 0;
      if (opening > 0) out.push({ side: sideOf(d), open: opening, first: d, fills: [fill(d, "entry", opening, opening / d.volume, offsetSeconds, ":open")] });
    } else {
      return `unknown deal entry value ${d.entry}`;
    }
  }
  return out;
}

const total = (fills: NormalizedFill[], f: (x: NormalizedFill) => number) => round(fills.reduce((t, x) => t + f(x), 0));

export function normalizeDeals(deals: RawDeal[], orders: RawOrder[], offsetSeconds = 0): NormalizeResult {
  const orderByTicket = new Map(orders.map((o) => [o.ticket, o]));
  const byPosition = new Map<number, RawDeal[]>();
  const result: NormalizeResult = { trades: [], incomplete: [], nonTrade: 0, cancelled: [] };

  for (const d of deals) {
    if (d.type === BUY_CANCELED || d.type === SELL_CANCELED) {
      result.cancelled.push(String(d.position_id));
    } else if (d.type !== BUY && d.type !== SELL) {
      result.nonTrade++;
    } else if (!d.position_id) {
      result.incomplete.push({ positionId: "0", reason: `deal ${d.ticket} has no position` });
    } else {
      byPosition.set(d.position_id, [...(byPosition.get(d.position_id) ?? []), d]);
    }
  }

  for (const [id, list] of byPosition) {
    list.sort((a, b) => (a.time_msc || a.time * 1000) - (b.time_msc || b.time * 1000) || a.ticket - b.ticket);
    const segs = segments(list, offsetSeconds);
    if (typeof segs === "string") {
      result.incomplete.push({ positionId: String(id), reason: segs });
      continue;
    }
    segs.forEach((s, i) => {
      // Only the opening deal counts: an exit deal's stop may have been trailed.
      const order = orderByTicket.get(s.first.order);
      const entry = s.fills[0].price;
      result.trades.push({
        sourceKey: i === 0 ? `pos:${id}` : `pos:${id}:r${i}`,
        positionId: String(id),
        symbol: s.first.symbol,
        side: s.side,
        stopPrice: validStop(s.side, entry, s.first.sl || order?.sl),
        targetPrice: s.first.tp || order?.tp || null,
        commission: total(s.fills, (f) => f.commission),
        swap: total(s.fills, (f) => f.swap),
        otherFees: total(s.fills, (f) => f.fee),
        brokerProfit: total(s.fills, (f) => f.profit),
        fills: s.fills,
      });
    });
  }
  return result;
}

const MAX_OFFSET = 14 * 3600;
const FRESH_SECONDS = 120;

/**
 * Broker server time minus UTC, or null when it can't be told. Assumes a quote's time is server
 * clock written as an epoch, which is common trader lore and not in the docs: unverified.
 * Offsets land on half hours, so a quote is only trusted when it sits within two minutes of one.
 */
export function brokerOffsetSeconds(quoteTime: number | null | undefined, utcNow: number): number | null {
  if (!quoteTime) return null;
  const diff = quoteTime - utcNow;
  const offset = Math.round(diff / 1800) * 1800;
  if (Math.abs(diff - offset) > FRESH_SECONDS || Math.abs(offset) > MAX_OFFSET) return null;
  return offset === 0 ? 0 : offset;
}
