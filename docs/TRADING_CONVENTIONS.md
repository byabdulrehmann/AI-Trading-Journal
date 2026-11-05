# Trading conventions

How Jarvis should treat the awkward cases. These are judgment calls for a single-user forex and gold journal, not an industry standard. MT5 facts come from the sources in `.claude/skills/trading-domain/SKILL.md`. Formulas and worked numbers are in `src/lib/domain/engine/vectors.json`.

**Rule behind all of them:** never turn "unknown" into 0. A missing value stays null and is flagged, so statistics stay honest.

## Breakeven trades

- A trade is breakeven when net P&L rounded to 2dp is exactly 0.
- Classify on net, not gross. A trade closed at its entry price with $7 commission is a $7 loss.
- Classify after rounding, so float residue such as -0.0000000001 is not a loss.
- Breakeven counts in the win-rate denominator, is neither a win nor a loss, and breaks both streak types.

## Open and partially closed positions

- **Open (no exits):** not a closed trade. Excluded from win rate, profit factor, expectancy, streaks, and drawdown.
- **Partially closed:** realized P&L covers the closed volume only. Floating P&L on the rest is displayed separately and never stored as P&L.
- A partially closed position stays out of trade statistics until flat. Its R is shown as provisional, because risk covers all entered volume while P&L covers only the closed part.
- Costs paid so far are deducted from realized P&L as they occur.
- Decide attribution once and label it: trade statistics use the final close time; a daily P&L calendar may use each exit deal's time. The two will legitimately differ on multi-day trades.

## Cancelled orders

- Cancelled, rejected, and expired orders (`ORDER_STATE_CANCELED`, `_REJECTED`, `_EXPIRED`) have no effect on P&L and are not trades.
- Build trades from deals, not orders.
- Keeping them as a separate log is optional. It can reveal behaviour such as repeatedly pulling limit orders.
- A cancelled deal (`DEAL_TYPE_BUY_CANCELED`, `DEAL_TYPE_SELL_CANCELED`) is different: the deal did execute, then was cancelled. Its profit is zeroed and the earlier result is settled by a balance operation. Exclude it from the trade, then re-derive that trade and flag it for review.

## Incomplete executions

- **Partly filled order:** `ORDER_STATE_PARTIAL`, or an order later cancelled with volume filled. Use the sum of its deals, never `ORDER_VOLUME_INITIAL`.
- **One order, several deals:** normal. Group them into one trade.
- **History cut off:** exits exceed known entries, or a position has exits and no opening deal. This usually means a date-window fetch started mid-position. Refetch with `history_deals_get(position=<id>)`.
- If it still does not reconcile, mark the trade incomplete and exclude it from statistics. Do not guess an entry price.
- **Exits greater than entries in one trade:** an import error unless it is a reversal, see below. Reject rather than clamp.
- Non-trade deals (balance, credit, bonus, dividend, interest, tax) are not trades. They belong on an account ledger.

## Missing fees

- Unknown fees are null, displayed as "fees unknown", and the net is marked estimated. Zero means the broker reported zero.
- CSV imports often omit swap or commission, so flag them rather than assume zero.
- Commission may not sit on the deal. Community reports suggest some accounts book it as a separate entry, or on the exit only. Unverified: check the user's own broker.
- Daily or monthly commission deals are account-level. Keep them in the account's total net P&L, but do not spread them across trades.
- Reconcile periodically: the sum of trade net P&L plus non-trade entries should equal the balance change.

## Missing stops

- Risk and R are null, never 0. P&L is still valid.
- Averages of R use only trades with a stop, and display the coverage: "avg R 1.4 (32 of 50 trades)".
- Show "no stop" as a discipline finding. It is itself useful to a trader.
- Use the **initial** stop. On MT5, an exit deal's `DEAL_SL` is the position's stop at close, possibly trailed. Use the entry deal's `DEAL_SL`.
- If the stop was added just after entry, the entry deal may hold no stop. Allow manual entry, recorded as user-entered. MT5 reporting "no stop" as 0.0 is expected but unverified, so treat 0 as missing.
- Do not derive risk from a stop already moved past entry. The absolute-value formula would report that as positive risk, when the real initial risk is unknown.

## Currency conversion

- Prefer the broker's reported deal profit where it exists, and keep the price-based calculation as a check. A large gap means a bad spec or rate. That deal profit is in account currency is expected but not stated on the docs page opened: verify on a real non-USD symbol.
- Convert only when `currency_profit` differs from the account currency.
- Store the rate used with the trade, and never reconvert history at today's rate.
- A missing rate means money fields are null and flagged. Never assume 1.
- Costs are already in account currency, so do not apply the rate to them.
- Risk uses the same stored rate in the current formula. In reality the rate moves between entry and close, so this is a small approximation for cross pairs.
- Aggregating across accounts in different currencies needs a stated reporting currency. Otherwise show them separately.

## Zero-risk trades

- Stop equal to average entry gives null risk and null R, not infinity, and not 0.
- Compare after rounding to the symbol's `digits`, since a weighted average can differ from the stop by float residue and would produce an absurd R.
- A stop on the wrong side of entry, such as a long with its stop above entry, is not valid initial risk. Treat it as no initial stop and flag it.
- Trades moved to breakeven are not zero-risk trades. Their initial risk was real.

## Reopened and reversed positions

- **Closed, then reopened:** two trades. Each re-opened position gets its own position identifier.
- **Netting reversal (`DEAL_ENTRY_INOUT`):** the identifier stays the same, so one identifier holds two trades. Split the INOUT deal: the part that flattens the old position closes trade one, and the excess opens trade two.
  - Example: long 1.0, sell 1.5 gives 1.0 closed and short 0.5 opened.
  - Allocate that deal's commission pro rata by volume: 2/3 to the close, 1/3 to the open.
- **Hedging account:** no reversal. Long and short in one symbol are separate positions and separate trades.
- **Close-by (`DEAL_ENTRY_OUT_BY`):** closes two opposite positions against each other. Treat it as an exit on each position, and expect it to carry costs differently. The exact deal shape was not confirmed: test with a demo close-by.
- **Scaling back in after a partial exit, without going flat:** same trade. The average entry then depends on order of events, whereas the simple formula pools all entries. The vectors use the pooled formula, so document the choice in the engine.
- **Server-side re-open for swap:** the ticket may change while the identifier does not. Group by identifier.

## Feature checklist

From the public pages https://www.tradezella.com/ and https://www.tradezella.com/features, both fetched successfully, functionality only and in my own wording. These are marketing-level claims: nothing was tested in the product.

**Offered there**

- [ ] Broker sync, file upload, manual entry, multiple accounts
- [ ] Dashboard, calendar view, advanced filters, running P&L chart
- [ ] Win rate, expectancy, R-multiple, best and worst day, strengths and weaknesses reports
- [ ] Setup and mistake tags, trade ratings, habit tracking
- [ ] Notes, screenshots, journal templates, notebook linked to stats
- [ ] Playbooks: strategy rules and per-strategy performance
- [ ] Trade replay with fills on the chart
- [ ] Backtesting
- [ ] AI pattern and behaviour insights
- [ ] Prop firm rule tracking (daily drawdown, profit target, consistency)
- [ ] Sharing and mentor spaces

Likely out of scope for a local single-user app: community spaces, mentor mode, tick-level replay data.

**What a naive journal gets wrong, and a serious one needs**

These are my judgment, not claims about any product.

- [ ] Trades built from deals by position identifier, including reversals
- [ ] Partial fills, scale-ins, and partial exits
- [ ] Per-broker symbol specs snapshotted with each trade
- [ ] Net of commission and swap, with unknown fees kept distinct from zero
- [ ] Initial stop preserved separately from a trailed stop
- [ ] Conversion to account currency with the rate stored
- [ ] R coverage shown alongside average R
- [ ] Idempotent re-import, so that resyncing does not duplicate deals
- [ ] Reconciliation of trades against the account balance
- [ ] Session and time statistics that handle DST and the broker timezone
- [ ] Deposits and withdrawals kept out of performance figures
- [ ] Filters for symbol, session, side, setup, and hold time on every statistic
- [ ] Per-setup expectancy, not only win rate
- [ ] Daily loss and overtrading views

## Tested on this machine: don't copy MT5 servers.dat

The `servers.dat` from a terminal's data folder signed a separate copy of the terminal in to that terminal's account, with no login given (confirmed on 2026-11-06 by restoring only that file). So Jarvis's terminal starts with its own default list, gets its credentials through `mt5.initialize`, and refuses to read anything if it finds itself on another account.
