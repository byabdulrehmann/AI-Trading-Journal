import { computePosition } from "../../lib/domain/engine/position";

/** The made-up trade on the page. Its printed figure comes from the real engine, not from the copy. */
export const trade = {
  side: "short",
  symbol: "XAUUSD",
  accountCurrency: "USD",
  contractSize: 100,
  entries: [{ price: 2318.4, qty: 0.2 }],
  exits: [{ price: 2322.9, qty: 0.2 }],
  commission: 1.4,
  swap: 0.6,
} as const;

/** The pencil figure, written out by hand on the page. */
export const HAND_NET = "−92.00";

export function engineNet(): string {
  const net = computePosition({ ...trade, entries: [...trade.entries], exits: [...trade.exits] }).netPnl ?? 0;
  return `${net < 0 ? "−" : ""}${Math.abs(net).toFixed(2)}`;
}
