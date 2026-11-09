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

## Backtest fills

A backtest is practice on the broker's past bars, so its fills follow fixed rules, stated on the page:

- **Entries and manual closes** fill at the close of the bar the session is on, the last price it has seen. The time is that bar's last second.
- **Stops and targets** are checked only on bars after the fill. A bar that reaches one fills at the level. A bar that opens past it fills at the open, so a gap through a stop costs more than the stop.
- **Both levels in one bar:** the stop is assumed first. It's the cautious reading, and the trade's exit reason says so.
- **Prices are MT5 bid bars.** The spread isn't added, and costs come from the fee defaults in Settings.
- **No peeking:** the page only ever receives bars up to the session's position, and a session only moves forward.
- **Kept apart:** each session's trades sit in an account of their own, with source `backtest`. They're left out of every live figure unless that session or source is asked for.

## Prop challenge rules

Firms word their rules differently. Jarvis reads them this way, and the Progress page says so beside each challenge.

- **Trades counted:** closed trades on the challenge's account whose firm trading day falls between its start and end dates. Trades still waiting on a conversion rate or fills are left out and counted on the card.
- **Trading day:** starts at the challenge's reset hour in its time zone. With a 17:00 reset, 18:00 on Monday counts as Tuesday.
- **Daily loss:** measured from the balance at the start of the trading day, at every closed trade. A day that fell past the limit and came back is still a breach. For today, the open positions' result from an MT5 sync taken today is added.
- **Max loss:** static keeps the floor at the account size minus the max loss. Trailing moves the floor up with the highest closed balance (never down) and stops at the account size. It trails closed balance, not intraday equity.
- **A limit reached exactly counts as breached.** That is the safe reading when a firm's wording is unclear.
- **Passed:** the profit target is reached, there are enough trading days (days with a closed trade), the consistency rule holds when set (the best day is at most the given share of total profit), and nothing was breached.
- **Warnings:** a limit at 80% or more of its size shows on the dashboard and the Progress page.
- **Spending** is kept per currency and never added across currencies.

## Economic calendar, auto-tags and reviews

- **Events** come only from the user: typed in, or imported from a CSV they downloaded. Jarvis fetches no news. Times in a file are read in the zone the user picks for that file; a row with no time (or "All day", "Tentative") is an all-day event. The same event at the same time and currency is stored once, so a file can be imported twice.
- **Which events count for a symbol:** those whose currency the symbol names (USD and EUR for EURUSD, USD for XAUUSD). A symbol naming no currency code, such as a stock or an index, counts every currency. All-day events never count as news.
- **News trade:** opened within N minutes, before or after, of a timed high-impact event that counts for its symbol.
- **Auto-tag rules** need every condition to match. Hours and weekdays are the open time in the user's time zone. Rules about hold time, R or P&L wait until the trade closes; a closed trade without a stop has no R, so an R condition is false. A rule tags a trade once, recorded per rule and trade: a tag the user removes stays removed, and deleting a rule leaves its tags. A trade already at 12 tags gets no more.
- **Reviews** count closed trades whose close falls in the period (week Monday to Sunday, or calendar month) in the user's time zone, per account currency. The numbers come from the record. The written review is optional, needs a connected AI model (never the demo responder), sends only what the Privacy setting allows, and is labelled with the model that wrote it.
- **Share pictures** are drawn in the browser and never uploaded. Money amounts are off by default; notes, account name and broker details are never on them.
- **Backups** are whole-database copies, owner only: one automatic copy a day while Jarvis runs, the last seven kept, plus copies made by hand. Restoring is done by hand with Jarvis stopped.

## Dashboard

The layout follows `docs/dashboard-visual-spec.md`. The score's method is in `docs/performance-score.md`.

- **Realized vs live:** the KPIs, score, both charts and the calendar count closed trades only. Floating P&L appears only in Open positions, which is labelled as live account data.
- **Open positions:** MT5 accounts show the positions from their last sync, marked stale with the sync time when the sync is old or failed. Accounts entered by hand show their open trades with "Price unavailable": Jarvis never makes up a price.
- **Days and weeks:** a day is the close date in the zone from Settings. The dashboard calendar runs Sunday to Saturday, and a week's card counts only that row's days inside the month shown. The Calendar page and weekly reports still use Monday weeks.
- **Date range** filters by open time, as on every other page. The charts and calendar place trades by close date, so a multi-day trade can sit just outside a chosen range.
- **Currencies** are never added together: the currency chip picks the one the totals are in, and positions in another currency are counted aside.
- **Kept per browser:** the sidebar's collapsed state, the calendar's month and display options, the trades card's tab and position columns. Filters stay in the URL.

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
- [x] Backtesting
- [ ] AI pattern and behaviour insights
- [x] Prop firm rule tracking (daily drawdown, profit target, consistency)
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

## Seen on this machine: MT5 refusal codes

The API gives -6 "Authorization failed" for a wrong password and also while the broker is refusing logins. The terminal log told them apart ("Invalid account", "Service is not available"), the API did not. So a connection that has worked only stops syncing after three refusals in a row.
