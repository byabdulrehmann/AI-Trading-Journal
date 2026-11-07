import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brokerOffsetSeconds, normalizeDeals, settleOffset, type RawDeal, type RawOrder } from "./normalize";

const T0 = 1_780_000_000;
let ticket = 1000;

/** Field names from MetaTrader5 5.0.6180's TradeDeal, values written by hand. Not real broker data. */
function deal(over: Partial<RawDeal>): RawDeal {
  ticket++;
  const time = over.time ?? T0 + ticket;
  return { ticket, order: ticket + 5000, time, time_msc: time * 1000, type: 0, entry: 0, magic: 0, position_id: 1, reason: 0, volume: 1, price: 1.1, commission: 0, swap: 0, profit: 0, fee: 0, symbol: "EURUSD", comment: "", external_id: "", ...over };
}
const order = (t: number, sl: number, tp = 0): RawOrder => ({ ticket: t, position_id: 1, sl, tp });

describe("normalizeDeals", () => {
  test("hedged account: two positions in one symbol stay two trades, side from the opening deal", () => {
    const { trades } = normalizeDeals([
      deal({ position_id: 1, type: 0, entry: 0 }),
      deal({ position_id: 2, type: 1, entry: 0, price: 1.2 }),
      deal({ position_id: 1, type: 1, entry: 1, profit: 50 }),
      deal({ position_id: 2, type: 0, entry: 1, profit: -20, price: 1.21 }),
    ], []);
    assert.deepEqual(trades.map((t) => [t.sourceKey, t.side, t.brokerProfit]), [["pos:1", "long", 50], ["pos:2", "short", -20]]);
  });

  test("partial close and scale-in group into one trade, and one deal is never a trade", () => {
    const { trades } = normalizeDeals([
      deal({ entry: 0, volume: 1 }),
      deal({ entry: 0, volume: 0.5 }),
      deal({ type: 1, entry: 1, volume: 0.7, profit: 30 }),
      deal({ type: 1, entry: 1, volume: 0.8, profit: 40 }),
    ], []);
    assert.equal(trades.length, 1);
    assert.deepEqual(trades[0].fills.map((f) => f.role), ["entry", "entry", "exit", "exit"]);
    assert.equal(trades[0].brokerProfit, 70);
  });

  test("an open remainder is still one trade, with realized profit only", () => {
    const { trades, incomplete } = normalizeDeals([deal({ entry: 0, volume: 1 }), deal({ type: 1, entry: 1, volume: 0.4, profit: 12 })], []);
    assert.equal(incomplete.length, 0);
    assert.equal(trades[0].brokerProfit, 12);
  });

  test("netting reversal: one identifier, two trades, split at the INOUT deal", () => {
    const { trades } = normalizeDeals([
      deal({ position_id: 7, entry: 0, volume: 1, type: 0, commission: -3 }),
      deal({ position_id: 7, entry: 2, volume: 1.5, type: 1, price: 1.2, profit: 100, commission: -6, swap: -1, fee: -3 }),
      deal({ position_id: 7, entry: 1, volume: 0.5, type: 0, price: 1.19, profit: 25, commission: -1 }),
    ], []);
    assert.deepEqual(trades.map((t) => [t.sourceKey, t.side]), [["pos:7", "long"], ["pos:7:r1", "short"]]);
    const [first, second] = trades;
    const closing = first.fills[1];
    const opening = second.fills[0];
    assert.deepEqual([closing.role, closing.quantity, closing.price], ["exit", 1, 1.2]);
    assert.deepEqual([opening.role, opening.quantity, opening.price], ["entry", 0.5, 1.2]);
    assert.notEqual(closing.brokerDealId, opening.brokerDealId);
    assert.equal(opening.brokerDealId, `${closing.brokerDealId}:open`);
    // Commission pro rata by volume (2/3, 1/3), per docs/TRADING_CONVENTIONS.md. Profit and swap stay on the close.
    assert.equal(first.commission, 7);
    assert.equal(second.commission, 3);
    assert.equal(first.otherFees, 2);
    assert.equal(second.otherFees, 1);
    assert.equal(first.swap, 1);
    assert.equal(second.swap, 0);
    assert.equal(first.brokerProfit, 100);
    assert.equal(second.brokerProfit, 25);
  });

  test("an exact-size INOUT only closes", () => {
    const { trades } = normalizeDeals([deal({ entry: 0, volume: 1 }), deal({ entry: 2, type: 1, volume: 1, profit: 5 })], []);
    assert.deepEqual(trades.map((t) => t.sourceKey), ["pos:1"]);
  });

  test("close-by is an exit on each of the two positions", () => {
    const { trades } = normalizeDeals([
      deal({ position_id: 1, type: 0, entry: 0 }),
      deal({ position_id: 2, type: 1, entry: 0 }),
      deal({ position_id: 1, type: 1, entry: 3, profit: 10 }),
      deal({ position_id: 2, type: 0, entry: 3, profit: -8 }),
    ], []);
    assert.deepEqual(trades.map((t) => [t.fills[1].role, t.brokerProfit]), [["exit", 10], ["exit", -8]]);
  });

  test("MT5's negative charges become positive costs, once, and credits go negative", () => {
    const { trades } = normalizeDeals([
      deal({ entry: 0, commission: -3.5, swap: 0, fee: -0.5 }),
      deal({ type: 1, entry: 1, commission: -3.5, swap: 2, profit: 10 }),
    ], []);
    const t = trades[0];
    assert.equal(t.commission, 7);
    assert.equal(t.swap, -2);
    assert.equal(t.otherFees, 0.5);
    assert.deepEqual(t.fills.map((f) => f.commission), [3.5, 3.5]);
  });

  test("no cost comes out as negative zero", () => {
    const t = normalizeDeals([deal({ entry: 0 })], []).trades[0];
    assert.ok(Object.is(t.commission, 0));
    assert.ok(Object.is(t.swap, 0));
  });

  test("balance, credit, commission and similar deals are not trades", () => {
    const r = normalizeDeals([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((type) => deal({ type, position_id: 0, profit: 100 })), []);
    assert.equal(r.trades.length, 0);
    assert.equal(r.incomplete.length, 0);
    assert.equal(r.nonTrade, 11);
  });

  test("a cancelled deal stays out of the trade and is flagged", () => {
    const r = normalizeDeals([deal({ entry: 0 }), deal({ type: 13, entry: 1, profit: 0 })], []);
    assert.equal(r.trades[0].fills.length, 1);
    assert.deepEqual(r.cancelled, ["1"]);
  });

  for (const [name, deals] of [
    ["an exit with no opening deal", [deal({ type: 1, entry: 1, profit: 10 })]],
    ["a reversal with no opening deal", [deal({ type: 1, entry: 2, volume: 1.5, profit: 10 })]],
    ["exits larger than entries", [deal({ entry: 0, volume: 1 }), deal({ type: 1, entry: 1, volume: 2 })]],
    ["an unknown entry value", [deal({ entry: 9 })]],
  ] as [string, RawDeal[]][]) {
    test(`cut-off history: ${name} is marked incomplete and no entry is invented`, () => {
      const r = normalizeDeals(deals, []);
      assert.equal(r.trades.length, 0);
      assert.deepEqual(r.incomplete.map((i) => i.positionId), ["1"]);
    });
  }

  test("float residue in volumes doesn't break a close", () => {
    const { trades, incomplete } = normalizeDeals([deal({ entry: 0, volume: 0.1 }), deal({ entry: 0, volume: 0.2 }), deal({ type: 1, entry: 1, volume: 0.3 })], []);
    assert.equal(incomplete.length, 0);
    assert.equal(trades.length, 1);
  });

  test("deals sort by time whatever order they arrive in", () => {
    const [a, b] = [deal({ entry: 0, time: T0 }), deal({ type: 1, entry: 1, time: T0 + 60 })];
    assert.equal(normalizeDeals([b, a], []).incomplete.length, 0);
  });

  describe("initial stop", () => {
    test("comes from the opening order, since the package's deals have no sl", () => {
      const open = deal({ entry: 0, price: 1.1 });
      const { trades } = normalizeDeals([open, deal({ type: 1, entry: 1 })], [order(open.order, 1.09, 1.13)]);
      assert.equal(trades[0].stopPrice, 1.09);
      assert.equal(trades[0].targetPrice, 1.13);
    });

    test("uses the entry deal's sl when one exists, never an exit's", () => {
      const open = deal({ entry: 0, price: 1.1, sl: 1.08 });
      const { trades } = normalizeDeals([open, deal({ type: 1, entry: 1, sl: 1.095 })], [order(open.order, 1.09)]);
      assert.equal(trades[0].stopPrice, 1.08);
      const noStop = normalizeDeals([deal({ position_id: 9, entry: 0, price: 1.1 }), deal({ position_id: 9, type: 1, entry: 1, sl: 1.095 })], []);
      assert.equal(noStop.trades[0].stopPrice, null);
    });

    test("0 means none", () => {
      const open = deal({ entry: 0 });
      const t = normalizeDeals([open], [order(open.order, 0, 0)]).trades[0];
      assert.equal(t.stopPrice, null);
      assert.equal(t.targetPrice, null);
    });

    test("a stop on the wrong side of entry is not initial risk", () => {
      const open = deal({ entry: 0, type: 0, price: 1.1 });
      assert.equal(normalizeDeals([open], [order(open.order, 1.2)]).trades[0].stopPrice, null);
    });

    test("a reversal's trade takes its stop from the reversing order", () => {
      const inout = deal({ entry: 2, type: 1, volume: 2, price: 1.2 });
      const { trades } = normalizeDeals([deal({ entry: 0, volume: 1, price: 1.1, time: T0 - 100 }), inout], [order(inout.order, 1.25)]);
      assert.equal(trades[0].stopPrice, null);
      assert.equal(trades[1].stopPrice, 1.25);
    });
  });

  test("raw deal JSON is kept, and times shift by the broker offset", () => {
    const d = deal({ entry: 0, time: T0, time_msc: T0 * 1000 + 250 });
    const f = normalizeDeals([d], [], 7200).trades[0].fills[0];
    assert.deepEqual(JSON.parse(f.raw), d);
    assert.equal(f.executedAt, new Date((T0 - 7200) * 1000 + 250).toISOString());
  });
});

describe("settling the broker's offset", () => {
  const q = 1_780_000_000;
  test("the first measurement is taken as it comes", () => {
    assert.deepEqual(settleOffset(null, null, 7200, q), { offset: 7200, candidate: null, changed: false });
  });

  test("weekend quotes that never move can't change it, however often they're seen", () => {
    let state = { offset: 7200 as number | null, candidate: null as ReturnType<typeof settleOffset>["candidate"] };
    for (let i = 0; i < 20; i++) {
      const r = settleOffset(state.offset, state.candidate, -32400, q);
      assert.equal(r.offset, 7200);
      assert.equal(r.changed, false);
      state = { offset: r.offset, candidate: r.candidate };
    }
  });

  test("a real change, seen three times with moving quotes, is taken", () => {
    const a = settleOffset(7200, null, 10800, q);
    const b = settleOffset(a.offset, a.candidate, 10800, q + 60);
    assert.deepEqual([a.offset, b.offset, b.changed], [7200, 7200, false]);
    const c = settleOffset(b.offset, b.candidate, 10800, q + 120);
    assert.deepEqual([c.offset, c.changed, c.candidate], [10800, true, null]);
  });

  test("a different reading in between starts the count again", () => {
    const a = settleOffset(7200, null, 10800, q);
    const b = settleOffset(a.offset, a.candidate, 14400, q + 60);
    const c = settleOffset(b.offset, b.candidate, 10800, q + 120);
    assert.equal(c.candidate?.seen, 1);
    assert.equal(c.offset, 7200);
  });

  test("measuring the stored value again clears a pending candidate", () => {
    const a = settleOffset(7200, null, 10800, q);
    assert.equal(settleOffset(a.offset, a.candidate, 7200, q + 60).candidate, null);
  });

  test("no measurement keeps everything as it was", () => {
    const pending = { value: 10800, quoteTime: q, seen: 2 };
    assert.deepEqual(settleOffset(7200, pending, null, null), { offset: 7200, candidate: pending, changed: false });
  });
});

describe("brokerOffsetSeconds", () => {
  const now = 1_780_000_000;
  test("a fresh quote gives the offset, to the half hour", () => {
    assert.equal(brokerOffsetSeconds(now + 7200 - 5, now), 7200);
    assert.equal(brokerOffsetSeconds(now + 19800, now), 19800);
    assert.equal(brokerOffsetSeconds(now - 3, now), 0);
  });
  test("a stale or missing quote gives no answer rather than a wrong one", () => {
    assert.equal(brokerOffsetSeconds(null, now), null);
    assert.equal(brokerOffsetSeconds(now + 7200 - 900, now), null);
    assert.equal(brokerOffsetSeconds(now - 2 * 86400, now), null);
  });
});
